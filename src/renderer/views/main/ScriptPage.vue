<template>
  <div class="script-page">
    <div class="toolbar">
      <el-button type="primary" @click="addScript">
        <el-icon><Plus /></el-icon> 加载脚本文件
      </el-button>
      <el-button :disabled="selectedIds.length === 0" @click="batchReload">
        批量重载 ({{ selectedIds.length }})
      </el-button>
      <el-button type="danger" :disabled="selectedIds.length === 0" @click="batchDelete">
        批量删除 ({{ selectedIds.length }})
      </el-button>
    </div>

    <div class="table-wrap">
      <el-table
        :data="pagedScripts"
        row-key="id"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column prop="name" label="名称" width="160" sortable="custom" show-overflow-tooltip />
        <el-table-column prop="filePath" label="文件路径" min-width="250" sortable="custom" show-overflow-tooltip />
        <el-table-column label="类型" width="180">
          <template #default="{ row }">
            <el-tag
              v-for="type in row.types"
              :key="type"
              size="small"
              :type="tagType(type)"
              style="margin-right: 4px"
            >
              {{ typeLabel(type) }}
            </el-tag>
            <span v-if="!row.types?.length" style="color: #5e6065">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="brief" label="代码" min-width="260" show-overflow-tooltip />
        <el-table-column prop="loadedAt" label="加载时间" width="170" sortable="custom" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openRename(row)">重命名</el-button>
            <el-button size="small" text @click="reloadScriptFile(row)">重载</el-button>
            <el-button size="small" text type="danger" @click="removeScript(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="sortedScripts.length"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { Plus } from '@element-plus/icons-vue';
import { IPC } from '@common/ipcChannels';
import type { ProcessScript, PromptInitData, PromptResult, ScriptType } from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';
import { alertDialog, confirmDialog } from '@/services/dialog-service';
import {
  deleteScript,
  getAllScripts,
  importScript,
  reloadScriptFromFile,
  renameScript as dbRenameScript,
} from '@/db/database';

/** 脚本类型对应的标签配色 */
const TAG_TYPES: Record<ScriptType, 'success' | 'warning' | 'danger'> = {
  'select-image': 'success',
  'identify-character': 'warning',
  'identify-structure': 'danger',
};

/** 脚本类型的中文名 */
const TYPE_LABELS: Record<ScriptType, string> = {
  'select-image': '图片',
  'identify-character': '角色',
  'identify-structure': '结构',
};

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const scripts = ref<ProcessScript[]>([]);
const selectedIds = ref<number[]>([]);
const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

/** 等待输入窗口返回的重命名目标 */
const pendingRenameId = ref<number | null>(null);

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const sortedScripts = computed(() => {
  const prop = sortProp.value;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...scripts.value].sort((a, b) => a.name.localeCompare(b.name));
  }

  const direction = order === 'ascending' ? 1 : -1;
  return [...scripts.value].sort((a, b) => {
    const left = String((a as Record<string, unknown>)[prop] ?? '');
    const right = String((b as Record<string, unknown>)[prop] ?? '');
    return left.localeCompare(right) * direction;
  });
});

const pagedScripts = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedScripts.value.slice(start, start + pageSize.value);
});

function tagType(type: ScriptType): 'success' | 'warning' | 'danger' {
  return TAG_TYPES[type];
}

function typeLabel(type: ScriptType): string {
  return TYPE_LABELS[type];
}

// ------------------------------------------------------------
// 列表操作
// ------------------------------------------------------------

async function loadData(): Promise<void> {
  scripts.value = await getAllScripts();
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function onSelectionChange(rows: ProcessScript[]): void {
  selectedIds.value = rows.map((row) => row.id);
}

/** 从磁盘加载脚本文件：源码同时写入数据库，文件丢失后仍可执行 */
async function addScript(): Promise<void> {
  const filePaths: string[] = await ipcRenderer.invoke(IPC.DIALOG_OPEN_SCRIPT);
  if (!filePaths?.length) {
    return;
  }

  for (const filePath of filePaths) {
    await importScript(filePath);
  }
  await loadData();
}

async function reloadScriptFile(script: ProcessScript): Promise<void> {
  try {
    await reloadScriptFromFile(script.filePath);
    await loadData();
  } catch (error) {
    await alertDialog({ title: '重载失败', message: (error as Error).message, danger: true });
  }
}

async function batchReload(): Promise<void> {
  const targets = scripts.value.filter((script) => selectedIds.value.includes(script.id));
  for (const script of targets) {
    try {
      await reloadScriptFromFile(script.filePath);
    } catch (error) {
      console.error(`重载失败 [${script.name}]：`, error);
    }
  }
  await loadData();
}

async function removeScript(script: ProcessScript): Promise<void> {
  const confirmed = await confirmDialog({
    title: '删除脚本',
    message: `确定删除脚本「${script.name}」？`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await deleteScript(script.id);
  await loadData();
}

async function batchDelete(): Promise<void> {
  const confirmed = await confirmDialog({
    title: '批量删除脚本',
    message: `确定删除选中的 ${selectedIds.value.length} 个脚本？`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  for (const id of selectedIds.value) {
    await deleteScript(id);
  }
  await loadData();
}

// ------------------------------------------------------------
// 重命名
// ------------------------------------------------------------

function openRename(script: ProcessScript): void {
  pendingRenameId.value = script.id;
  const payload: PromptInitData = {
    title: '重命名脚本',
    placeholder: '新名称',
    value: script.name,
    channel: IPC.SCRIPT_RENAME_CONFIRMED,
  };
  ipcRenderer.invoke(IPC.PROMPT_OPEN, payload);
}

useIpcListener(IPC.SCRIPT_RENAME_CONFIRMED, async (result: PromptResult) => {
  if (pendingRenameId.value === null || !result.value) {
    return;
  }
  await dbRenameScript(pendingRenameId.value, result.value);
  pendingRenameId.value = null;
  await loadData();
});

onMounted(loadData);
</script>

<style scoped>
.script-page {
  padding: 0 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
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
