<template>
  <div class="library-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <div class="toolbar-right">
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
        v-loading="exporting"
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
          <template #default="{ row }">{{ row.scriptName || '手动确认' }}</template>
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

    <el-dialog v-model="exportProgressVisible" title="导出进度" width="400px" :close-on-click-modal="false">
      <el-progress :percentage="exportPercent" />
      <p style="margin-top: 12px">
        已导出 {{ exportedCount }} / {{ totalExportCount }}，错误 {{ exportErrorCount }}
      </p>
      <template #footer>
        <el-button :disabled="exporting" @click="exportProgressVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { computed, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { Download } from '@element-plus/icons-vue';
import { IPC } from '@common/ipcChannels';
import type { Gallery, ProcessedImageView, ViewerPayload } from '@common/types';
import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterItem, FilterSection } from '@/components/CategorySearch.types';
import { useFilterOrder } from '@/composables/useFilterOrder';
import { deleteProcessedImage, getAllGalleries, getAllProcessedImages } from '@/db/database';

/** 导出进度的刷新间隔，同时让出主线程给界面渲染 */
const EXPORT_REFRESH_MS = 50;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const processedImages = ref<ProcessedImageView[]>([]);
const galleries = ref<Gallery[]>([]);
const selectedIds = ref<number[]>([]);

const exporting = ref(false);
const exportProgressVisible = ref(false);
const exportPercent = ref(0);
const exportedCount = ref(0);
const totalExportCount = ref(0);
const exportErrorCount = ref(0);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const galleryFilter = ref<number | undefined>(undefined);
const characterFilter = ref('');
const fileNameFilter = ref('');
const scriptFilter = ref('');

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

const galleryItems = computed(() =>
  galleries.value.map((gallery) => ({ label: gallery.name, value: String(gallery.id) })),
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
    key: 'gallery',
    label: '图库',
    value: galleryFilter.value ? String(galleryFilter.value) : '',
    display: galleries.value.find((gallery) => gallery.id === galleryFilter.value)?.name ?? '',
    items: galleryItems.value,
    onSelect: (value: string) => {
      galleryFilter.value = Number(value);
      activateFilter('gallery');
    },
    onClear: () => {
      galleryFilter.value = undefined;
      deactivateFilter('gallery');
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

  if (galleryFilter.value) {
    list = list.filter((image) => image.galleryId === galleryFilter.value);
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
  galleries.value = await getAllGalleries();
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
  if (!confirm(`确定删除「${row.characterName} - ${row.selectedFileName}」？\n（不会删除原始文件）`)) {
    return;
  }
  await deleteProcessedImage(row.id);
  await loadData();
}

async function batchDelete(): Promise<void> {
  if (selectedIds.value.length === 0) {
    return;
  }
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 条记录？\n（不会删除原始文件）`)) {
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

/**
 * 导出到指定目录，结构为 {目标目录}/{角色名}/{角色名}_{0001}.{扩展名}。
 *
 * 序号按角色在本轮导出中的出现顺序递增，这里保持原有约定不变。
 */
async function exportImages(): Promise<void> {
  const targetDir: string | null = await ipcRenderer.invoke(IPC.DIALOG_EXPORT_DIR);
  if (!targetDir) {
    return;
  }

  if (!existsSync(targetDir)) {
    if (!confirm(`目录「${targetDir}」不存在，是否创建？`)) {
      return;
    }
    mkdirSync(targetDir, { recursive: true });
  }

  const images = selectedIds.value.length > 0
    ? sortedImages.value.filter((image) => selectedIds.value.includes(image.id))
    : sortedImages.value;
  if (images.length === 0) {
    return;
  }

  exporting.value = true;
  exportProgressVisible.value = true;
  exportedCount.value = 0;
  totalExportCount.value = images.length;
  exportErrorCount.value = 0;
  exportPercent.value = 0;

  const counters = new Map<string, number>();
  try {
    for (const [index, image] of images.entries()) {
      try {
        copyImage(image, targetDir, counters);
        exportedCount.value += 1;
      } catch (error) {
        exportErrorCount.value += 1;
        console.error(`导出失败 [${image.selectedFile}]：`, error);
      }

      exportPercent.value = Math.round(((index + 1) / images.length) * 100);
      await delay(EXPORT_REFRESH_MS);
    }
  } finally {
    exporting.value = false;
  }

  alert(`导出完成！\n成功：${exportedCount.value}，错误：${exportErrorCount.value}`);
}

/** 按「角色名 / 角色名_序号.扩展名」复制一张图片 */
function copyImage(image: ProcessedImageView, targetDir: string, counters: Map<string, number>): void {
  const sequence = (counters.get(image.characterName) ?? 0) + 1;
  counters.set(image.characterName, sequence);

  const characterDir = join(targetDir, image.characterName);
  mkdirSync(characterDir, { recursive: true });

  const fileName = `${image.characterName}_${String(sequence).padStart(4, '0')}${extname(image.selectedFile)}`;
  copyFileSync(image.selectedFile, join(characterDir, fileName));
}

/** 等待若干毫秒，给界面渲染的机会 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
