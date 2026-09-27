<template>
  <div class="source-page">
    <div class="toolbar">
      <el-button type="primary" @click="addSource">
        <el-icon><Plus /></el-icon> 添加来源
      </el-button>
      <el-button type="success" :disabled="selectedIds.length === 0" @click="openScanConfigForSelection">
        批量扫描 ({{ selectedIds.length }})
      </el-button>
      <el-button type="danger" :disabled="selectedIds.length === 0" @click="batchDelete">
        批量删除 ({{ selectedIds.length }})
      </el-button>
    </div>

    <div class="table-wrap">
      <el-table
        :data="pagedSources"
        row-key="id"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column prop="name" label="来源名称" min-width="200" sortable="custom" />
        <el-table-column prop="rootPath" label="路径" min-width="350" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="scannedAt" label="最近扫描" width="170" sortable="custom">
          <template #default="{ row }">
            {{ row.scannedAt || '未扫描' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openScanConfig(row)">扫描</el-button>
            <el-button size="small" text type="warning" @click="clearData(row)">清理数据</el-button>
            <el-button size="small" text type="danger" @click="removeSource(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="sortedSources.length"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { ElMessage } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { IPC } from '@common/ipcChannels';
import type { Source, ProcessScript, ScanConfigInitData, ScanConfigResult } from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';
import { useTasks } from '@/composables/useTasks';
import {
  addSource as dbAddSource, clearSourceData, deleteSource, getAllSources, getScriptsByType,
} from '@/db/database';
import { confirmDialog } from '@/services/dialog-service';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const sources = ref<Source[]>([]);
const structScripts = ref<ProcessScript[]>([]);
const selectedIds = ref<number[]>([]);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const { actions } = useTasks();

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const sortedSources = computed(() => {
  const prop = sortProp.value;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...sources.value].sort((a, b) => a.name.localeCompare(b.name));
  }

  const direction = order === 'ascending' ? 1 : -1;
  return [...sources.value].sort((a, b) => {
    const left = String((a as Record<string, unknown>)[prop] ?? '');
    const right = String((b as Record<string, unknown>)[prop] ?? '');
    return left.localeCompare(right) * direction;
  });
});

const pagedSources = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedSources.value.slice(start, start + pageSize.value);
});

// ------------------------------------------------------------
// 列表操作
// ------------------------------------------------------------

async function loadSources(): Promise<void> {
  sources.value = await getAllSources();
  structScripts.value = await getScriptsByType('identify-structure');
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function onSelectionChange(rows: Source[]): void {
  selectedIds.value = rows.map((row) => row.id);
}

/** 通过系统对话框添加来源，支持一次选择多个目录 */
async function addSource(): Promise<void> {
  const rootPaths: string[] = await ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR);
  if (!rootPaths?.length) {
    return;
  }

  for (const rootPath of rootPaths) {
    try {
      await dbAddSource(rootPath);
    } catch (error) {
      // 目录已添加过会命中 root_path 唯一约束，属于预期内的忽略
      if (!(error as Error).message?.includes('UNIQUE')) {
        console.error(`添加来源失败：${rootPath}`, error);
      }
    }
  }
  await loadSources();
}

async function clearData(source: Source): Promise<void> {
  const confirmed = await confirmDialog({
    title: '清理来源数据',
    message: `确定清理来源「${source.name}」的所有扫描数据？\n（不会删除原始文件）`,
    confirmText: '清理',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await clearSourceData(source.id);
  await loadSources();
}

async function removeSource(source: Source): Promise<void> {
  const confirmed = await confirmDialog({
    title: '删除来源',
    message: `确定删除来源「${source.name}」及其所有扫描数据？\n（不会删除原始文件）`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await deleteSource(source.id);
  await loadSources();
}

async function batchDelete(): Promise<void> {
  const confirmed = await confirmDialog({
    title: '批量删除来源',
    message: `确定删除选中的 ${selectedIds.value.length} 个来源及其所有扫描数据？\n（不会删除原始文件）`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  for (const id of selectedIds.value) {
    await deleteSource(id);
  }
  await loadSources();
}

// ------------------------------------------------------------
// 扫描
// ------------------------------------------------------------

function openScanConfig(source: Source): void {
  ipcRenderer.invoke(IPC.SCAN_CONFIG_OPEN, buildScanConfigPayload([source]));
}

function openScanConfigForSelection(): void {
  const targets = sources.value.filter((source) => selectedIds.value.includes(source.id));
  ipcRenderer.invoke(IPC.SCAN_CONFIG_OPEN, buildScanConfigPayload(targets));
}

/** 组装扫描配置窗口的初始化数据 */
function buildScanConfigPayload(targets: Source[]): ScanConfigInitData {
  return {
    scripts: structScripts.value.map((script) => ({ id: script.id, name: script.name })),
    sourceIds: targets.map((source) => source.id),
    sourceName: targets.length === 1 ? targets[0].name : '',
    sourceCount: targets.length,
  };
}

useIpcListener(IPC.SCAN_CONFIG_CONFIRMED, (result: ScanConfigResult) => {
  void submitScanTasks(result);
});

/** 一个来源一个任务：进度独立，可以单独取消、暂停与重试 */
async function submitScanTasks(result: ScanConfigResult): Promise<void> {
  for (const sourceId of result.sourceIds) {
    await actions.submit('scan', { sourceId, scriptId: result.scriptId });
  }
  ElMessage.success(`已提交 ${result.sourceIds.length} 个扫描任务，可在「任务」页查看进度`);
}

onMounted(loadSources);
</script>

<style scoped>
.source-page {
  padding: var(--page-padding);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.table-wrap {
  flex: 1;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  height: 100%;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
