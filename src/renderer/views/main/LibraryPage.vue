<template>
  <div class="library-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <div class="toolbar-right">
        <el-button :disabled="recognizing" @click="recognizeSimilar">
          {{ recognizing ? '识别中…' : '识别相似图片' }}
        </el-button>
        <el-button type="danger" :disabled="selectedIds.length === 0" @click="batchDelete">
          删除选中 ({{ selectedIds.length }})
        </el-button>
        <el-button type="success" :disabled="sortedImages.length === 0" @click="exportImages">
          <el-icon><Download /></el-icon> 导出 ({{ selectedIds.length || sortedImages.length }})
        </el-button>
      </div>
    </div>

    <div class="table-wrap">
      <el-table
        :data="pagedImages"
        row-key="id"
        style="width: 100%"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column label="预览" width="90">
          <template #default="{ row }">
            <img
              v-if="row.selectedFileThumbnail"
              class="preview"
              :src="row.selectedFileThumbnail"
              @click="openViewer(row)"
            />
            <span v-else style="font-size: 24px">🖼</span>
          </template>
        </el-table-column>
        <el-table-column prop="characterName" label="角色" width="160" sortable="custom" />
        <el-table-column prop="selectedFileName" label="文件名" min-width="220" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="scriptName" label="处理脚本" width="150" sortable="custom">
          <template #default="{ row }">{{ scriptLabel(row) }}</template>
        </el-table-column>
        <el-table-column prop="confirmedAt" label="确认时间" width="170" sortable="custom" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="deleteOne(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]"
      :total="sortedImages.length"
      layout="total, sizes, prev, pager, next, jumper"
      class="pager"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ipcRenderer } from 'electron';
import { ElMessage } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import { IPC } from '@common/ipcChannels';
import type { Source, ProcessedImageView, TaskView, ViewerPayload } from '@common/types';
import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterItem, FilterSection } from '@/components/CategorySearch.types';
import { useFilterOrder } from '@/composables/useFilterOrder';
import { useIpcListener } from '@/composables/useIpcListener';
import { useTasks } from '@/composables/useTasks';
import { deleteProcessedImage, getAllSources, getAllProcessedImages } from '@/db/database';
import { confirmDialog } from '@/services/dialog-service';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const processedImages = ref<ProcessedImageView[]>([]);
const sources = ref<Source[]>([]);
const selectedIds = ref<number[]>([]);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const sourceFilter = ref<number | undefined>(undefined);
const characterFilter = ref('');
const fileNameFilter = ref('');
const scriptFilter = ref('');

const { tasks, actions } = useTasks();

/**
 * 「处理脚本」那一列显示什么。
 *
 * 名字是写入图库行时留下的副本：脚本被删掉之后它还在（改名时由主进程级联更新）；
 * 没有名字却有 script_id 说明库被手工改过、名字确实查不到了——不能假装成手动确认。
 */
function scriptLabel(row: ProcessedImageView): string {
  if (row.scriptName) {
    return row.scriptName;
  }
  return row.scriptId === null ? '手动确认' : '已删除脚本';
}

/** 识别任务是否在跑：跑的过程中禁用按钮 */
const recognizing = ref(false);
/** 本次要等的那条识别任务；0 表示当前没有在等 */
const watchedTaskId = ref(0);

/**
 * 提交识别任务并记住它的 id。
 *
 * 走 actions.submit 而不是直接调 submitTask：命令会返回整表（服务端已排好序），
 * 用它替换本地列表，顺序才不会错。
 */
async function recognizeSimilar(): Promise<void> {
  if (recognizing.value) {
    return;
  }
  recognizing.value = true;
  try {
    // 提交命令直接返回新任务 id，不需要去列表里猜
    watchedTaskId.value = await actions.submit('similar', {});
    ElMessage.success('已开始识别，完成后会自动打开结果窗口');
  } catch (error) {
    recognizing.value = false;
    ElMessage.error(`提交识别任务失败：${(error as Error).message}`);
  }
}

// 只盯自己提交的那条任务：完成就开窗，失败或被取消就放开按钮。
// 按 id 认任务，不靠"列表里第一条已完成的识别任务"——那会在重复提交时认错。
watch(tasks, (list) => {
  if (watchedTaskId.value === 0) {
    return;
  }

  const task = list.find((item) => item.id === watchedTaskId.value);
  if (!task) {
    return;
  }

  if (task.status === 'done') {
    watchedTaskId.value = 0;
    recognizing.value = false;
    void ipcRenderer.invoke(IPC.SIMILAR_OPEN);
    return;
  }

  if (task.status === 'failed' || task.status === 'cancelled') {
    watchedTaskId.value = 0;
    recognizing.value = false;
    ElMessage.error('识别相似图片未完成，详情见任务页');
  }
}, { deep: true });

const { order: filterOrder, activate: activateFilter, deactivate: deactivateFilter } = useFilterOrder(() => {
  page.value = 1;
});

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

/** 去重并排序，生成下拉筛选项 */
function toFilterItems(values: string[]): FilterItem[] {
  return [...new Set(values)].sort().map((value) => ({ label: value, value }));
}

const sourceItems = computed(() =>
  sources.value.map((source) => ({ label: source.name, value: String(source.id) })),
);

const characterItems = computed(() =>
  toFilterItems(processedImages.value.map((image) => image.characterName)),
);

const scriptItems = computed(() =>
  toFilterItems(
    processedImages.value
      .map((image) => image.scriptName)
      .filter((name): name is string => name !== null),
  ),
);

const filterSections = computed<FilterSection[]>(() => [
  {
    key: 'source',
    label: '来源',
    value: sourceFilter.value ? String(sourceFilter.value) : '',
    display: sources.value.find((source) => source.id === sourceFilter.value)?.name ?? '',
    items: sourceItems.value,
    onSelect: (value: string) => {
      sourceFilter.value = Number(value);
      activateFilter('source');
    },
    onClear: () => {
      sourceFilter.value = undefined;
      deactivateFilter('source');
    },
  },
  {
    key: 'character',
    label: '角色',
    value: characterFilter.value,
    display: characterFilter.value,
    items: characterItems.value,
    onSelect: (value: string) => {
      characterFilter.value = value;
      activateFilter('character');
    },
    onClear: () => {
      characterFilter.value = '';
      deactivateFilter('character');
    },
  },
  {
    key: 'filename',
    label: '文件名',
    value: fileNameFilter.value,
    display: fileNameFilter.value,
    items: [],
    onSelect: (value: string) => {
      fileNameFilter.value = value;
      activateFilter('filename');
    },
    onClear: () => {
      fileNameFilter.value = '';
      deactivateFilter('filename');
    },
  },
  {
    key: 'script',
    label: '处理脚本',
    value: scriptFilter.value,
    display: scriptFilter.value,
    items: scriptItems.value,
    onSelect: (value: string) => {
      scriptFilter.value = value;
      activateFilter('script');
    },
    onClear: () => {
      scriptFilter.value = '';
      deactivateFilter('script');
    },
  },
]);

const filteredImages = computed(() => {
  let list = processedImages.value;

  if (sourceFilter.value) {
    list = list.filter((image) => image.sourceId === sourceFilter.value);
  }
  if (characterFilter.value) {
    list = list.filter((image) => image.characterName === characterFilter.value);
  }
  if (fileNameFilter.value) {
    const keyword = fileNameFilter.value.toLowerCase();
    list = list.filter((image) => image.selectedFileName.toLowerCase().includes(keyword));
  }
  if (scriptFilter.value) {
    list = list.filter((image) => (image.scriptName || '手动确认') === scriptFilter.value);
  }
  return list;
});

const sortedImages = computed(() => {
  const list = filteredImages.value;
  const prop = sortProp.value;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...list].sort((a, b) => a.characterName.localeCompare(b.characterName));
  }

  const direction = order === 'ascending' ? 1 : -1;
  return [...list].sort((a, b) => {
    const left = String((a as Record<string, unknown>)[prop] ?? '');
    const right = String((b as Record<string, unknown>)[prop] ?? '');
    return left.localeCompare(right) * direction;
  });
});

const pagedImages = computed(() =>
  sortedImages.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

// ------------------------------------------------------------
// 列表操作
// ------------------------------------------------------------

async function loadData(): Promise<void> {
  processedImages.value = await getAllProcessedImages();
  sources.value = await getAllSources();
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function onSelectionChange(rows: ProcessedImageView[]): void {
  selectedIds.value = rows.map((row) => row.id);
}

async function openViewer(target: ProcessedImageView): Promise<void> {
  const list = sortedImages.value;
  const index = list.indexOf(target);

  const payload: ViewerPayload = {
    files: list.map((image) => ({
      filePath: image.selectedFile,
      fileName: image.selectedFileName,
      relativePath: image.selectedFileName,
      fileSize: image.selectedFileSize,
      width: image.selectedFileWidth,
      height: image.selectedFileHeight,
      thumbnail: image.selectedFileThumbnail,
    })),
    index: index >= 0 ? index : 0,
  };
  await ipcRenderer.invoke(IPC.VIEWER_OPEN, payload);
}

async function deleteOne(row: ProcessedImageView): Promise<void> {
  const confirmed = await confirmDialog({
    title: '删除记录',
    message: `确定删除「${row.characterName} - ${row.selectedFileName}」？\n（不会删除原始文件）`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await deleteProcessedImage(row.id);
  await loadData();
}

async function batchDelete(): Promise<void> {
  if (selectedIds.value.length === 0) {
    return;
  }
  const confirmed = await confirmDialog({
    title: '批量删除记录',
    message: `确定删除选中的 ${selectedIds.value.length} 条记录？\n（不会删除原始文件）`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  for (const id of selectedIds.value) {
    await deleteProcessedImage(id);
  }
  selectedIds.value = [];
  await loadData();
}

// ------------------------------------------------------------
// 导出
// ------------------------------------------------------------

/** 导出任务结束后刷新列表，让新增的失败记录可见 */
useIpcListener(IPC.TASK_CHANGED, (task: TaskView) => {
  if (task.type !== 'export') {
    return;
  }
  if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
    void loadData();
  }
});

/** 选中目录后把待导出记录固化成 id 快照，实际复制交给主进程 */
async function exportImages(): Promise<void> {
  const targetDir: string | null = await ipcRenderer.invoke(IPC.DIALOG_EXPORT_DIR);
  if (!targetDir) {
    return;
  }

  const images = selectedIds.value.length > 0
    ? sortedImages.value.filter((image) => selectedIds.value.includes(image.id))
    : sortedImages.value;
  if (images.length === 0) {
    return;
  }

  await actions.submit('export', { imageIds: images.map((image) => image.id), targetDir });
  ElMessage.success(`已提交 ${images.length} 张图片的导出任务，可在「任务」页查看进度`);
}

onMounted(loadData);
</script>

<style scoped>
.library-page {
  padding: 0 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  flex: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.table-wrap {
  flex: 1;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  height: 100%;
}

.preview {
  width: 50px;
  height: 50px;
  object-fit: cover;
  border-radius: 4px;
  cursor: pointer;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
