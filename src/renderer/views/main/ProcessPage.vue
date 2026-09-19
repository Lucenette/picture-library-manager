<template>
  <div class="process-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="openBatchDialog">
          批量处理 ({{ selectedIds.length || filteredGroups.length }})
        </el-button>
        <el-button :disabled="selectedIds.length === 0" @click="excludeSelected">标记排除</el-button>
        <el-button :disabled="selectedIds.length === 0" @click="unexcludeSelected">取消排除</el-button>
      </div>
    </div>

    <div class="table-wrap">
      <el-table
        v-loading="processing"
        :data="pagedGroups"
        row-key="id"
        style="width: 100%"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column prop="galleryName" label="图库" width="140" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="characterName" label="角色" width="160" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="dirName" label="图片组" min-width="140" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="dirPath" label="路径" min-width="360" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="fileCount" label="文件数" width="90" align="center" sortable="custom" />
        <el-table-column prop="status" label="状态" width="100" align="center" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="viewFiles(row)">查看文件</el-button>
            <el-button size="small" text type="danger" @click="toggleExclude(row)">
              {{ row.status === 'excluded' ? '恢复' : '排除' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]"
      :total="filteredGroups.length"
      layout="total, sizes, prev, pager, next, jumper"
      class="pager"
    />

    <el-dialog v-model="processProgressVisible" title="处理进度" width="400px" :close-on-click-modal="false">
      <el-progress :percentage="processPercent" />
      <p style="margin-top: 12px">已处理 {{ processedCount }} / {{ totalCount }}，错误 {{ errorCount }}</p>
      <template #footer>
        <el-button :disabled="processing" @click="processProgressVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { randomUUID } from 'crypto';
import { computed, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type {
  BatchProcessInitData, FileViewerInitData, Gallery, ImageGroupStatus, ImageGroupView, ProcessScript,
} from '@common/types';
import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterItem, FilterSection } from '@/components/CategorySearch.types';
import { useFilterOrder } from '@/composables/useFilterOrder';
import { useIpcListener } from '@/composables/useIpcListener';
import {
  beginBatch,
  endBatch,
  getAllGalleries,
  getImageFilesByGroup,
  getImageGroupIdByFilePath,
  getImageGroupsView,
  getScriptsByType,
  updateImageGroupStatus,
  upsertProcessedImage,
} from '@/db/database';
import { executeScript } from '@/services/script-runner';

/** 处理进度的刷新间隔，同时让出主线程给界面渲染 */
const PROGRESS_REFRESH_MS = 50;

/** 状态筛选项 */
const STATUS_ITEMS: FilterItem[] = [
  { label: '未处理', value: 'pending' },
  { label: '已处理', value: 'processed' },
  { label: '已排除', value: 'excluded' },
];

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const groups = ref<ImageGroupView[]>([]);
const scripts = ref<ProcessScript[]>([]);
const galleries = ref<Gallery[]>([]);
const selectedIds = ref<number[]>([]);
const selectedScriptId = ref<number | null>(null);

const processing = ref(false);
const processProgressVisible = ref(false);
const processPercent = ref(0);
const processedCount = ref(0);
const totalCount = ref(0);
const errorCount = ref(0);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const galleryFilter = ref<number | undefined>(undefined);
const characterFilter = ref('');
const pathFilter = ref('');
const statusFilter = ref('');

const { order: filterOrder, activate: activateFilter, deactivate: deactivateFilter } = useFilterOrder(() => {
  page.value = 1;
});

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const galleryItems = computed(() =>
  galleries.value.map((gallery) => ({ label: gallery.name, value: String(gallery.id) })),
);

const characterItems = computed(() =>
  [...new Set(groups.value.map((group) => group.characterName))]
    .sort()
    .map((name) => ({ label: name, value: name })),
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
    key: 'path',
    label: '路径',
    value: pathFilter.value,
    display: pathFilter.value,
    items: [],
    onSelect: (value: string) => {
      pathFilter.value = value;
      activateFilter('path');
    },
    onClear: () => {
      pathFilter.value = '';
      deactivateFilter('path');
    },
  },
  {
    key: 'status',
    label: '状态',
    value: statusFilter.value,
    display: STATUS_ITEMS.find((item) => item.value === statusFilter.value)?.label ?? '',
    items: STATUS_ITEMS,
    onSelect: (value: string) => {
      statusFilter.value = value;
      activateFilter('status');
    },
    onClear: () => {
      statusFilter.value = '';
      deactivateFilter('status');
    },
  },
]);

const filteredGroups = computed(() => {
  let list = groups.value;

  if (statusFilter.value) {
    list = list.filter((group) => group.status === statusFilter.value);
  }
  if (galleryFilter.value) {
    list = list.filter((group) => group.galleryId === galleryFilter.value);
  }
  if (characterFilter.value) {
    list = list.filter((group) => group.characterName === characterFilter.value);
  }
  if (pathFilter.value) {
    const keyword = pathFilter.value.toLowerCase();
    list = list.filter((group) => group.dirPath.toLowerCase().includes(keyword));
  }

  const prop = sortProp.value as keyof ImageGroupView | null;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...list].sort((a, b) =>
      a.galleryName.localeCompare(b.galleryName)
      || a.characterName.localeCompare(b.characterName)
      || a.dirName.localeCompare(b.dirName));
  }

  const direction = order === 'ascending' ? 1 : -1;
  return [...list].sort((a, b) => {
    const left = a[prop] ?? '';
    const right = b[prop] ?? '';
    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * direction;
    }
    return String(left).localeCompare(String(right)) * direction;
  });
});

const pagedGroups = computed(() =>
  filteredGroups.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

// ------------------------------------------------------------
// 列表操作
// ------------------------------------------------------------

async function loadData(): Promise<void> {
  groups.value = await getImageGroupsView();
  scripts.value = await getScriptsByType('select-image');
  galleries.value = await getAllGalleries();
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function onSelectionChange(rows: ImageGroupView[]): void {
  selectedIds.value = rows.map((row) => row.id);
}

function statusTagType(status: ImageGroupStatus): 'info' | 'success' | 'danger' {
  if (status === 'processed') {
    return 'success';
  }
  if (status === 'excluded') {
    return 'danger';
  }
  return 'info';
}

function statusLabel(status: ImageGroupStatus): string {
  if (status === 'processed') {
    return '已处理';
  }
  if (status === 'excluded') {
    return '已排除';
  }
  return '未处理';
}

async function toggleExclude(group: ImageGroupView): Promise<void> {
  const nextStatus: ImageGroupStatus = group.status === 'excluded' ? 'pending' : 'excluded';
  await updateImageGroupStatus(group.id, nextStatus);
  await loadData();
}

async function excludeSelected(): Promise<void> {
  for (const id of selectedIds.value) {
    await updateImageGroupStatus(id, 'excluded');
  }
  await loadData();
}

async function unexcludeSelected(): Promise<void> {
  for (const id of selectedIds.value) {
    await updateImageGroupStatus(id, 'pending');
  }
  await loadData();
}

async function viewFiles(group: ImageGroupView): Promise<void> {
  const payload: FileViewerInitData = {
    files: await getImageFilesByGroup(group.id),
    groupName: group.dirName,
    groupDirPath: group.dirPath,
  };
  ipcRenderer.invoke(IPC.FILE_VIEWER_OPEN, payload);
}

// ------------------------------------------------------------
// 手动确认
// ------------------------------------------------------------

useIpcListener(IPC.FILE_VIEWER_SELECTED, (filePath: string) => {
  void confirmSelectedFile(filePath);
});

/** 在文件查看窗口中选定某张图后，把它记为所属图片组的处理结果 */
async function confirmSelectedFile(filePath: string): Promise<void> {
  const groupId = await getImageGroupIdByFilePath(filePath);
  const group = groupId === null ? undefined : groups.value.find((item) => item.id === groupId);
  if (!group) {
    return;
  }

  try {
    await upsertProcessedImage(group.id, group.characterId, group.galleryId, group.dirPath, filePath, null);
    await loadData();
  } catch (error) {
    alert(`确认失败：${(error as Error).message}`);
  }
}

// ------------------------------------------------------------
// 批量处理
// ------------------------------------------------------------

useIpcListener(IPC.BATCH_PROCESS_CONFIRMED, (scriptId: number) => {
  selectedScriptId.value = scriptId;
  void doBatchProcess();
});

function openBatchDialog(): void {
  const targets = resolveTargets();
  if (targets.length === 0) {
    alert('选中的图片组都被排除');
    return;
  }

  const payload: BatchProcessInitData = {
    scripts: scripts.value.map((script) => ({ id: script.id, name: script.name })),
    count: targets.length,
  };
  ipcRenderer.invoke(IPC.BATCH_PROCESS_OPEN, payload);
}

/** 待处理的图片组：优先取勾选项，未勾选时取当前筛选结果，两者都排除已排除项 */
function resolveTargets(): ImageGroupView[] {
  const candidates = selectedIds.value.length > 0
    ? groups.value.filter((group) => selectedIds.value.includes(group.id))
    : filteredGroups.value;
  return candidates.filter((group) => group.status !== 'excluded');
}

/**
 * 逐个图片组执行选图脚本。
 *
 * 每个图片组都要读文件、跑脚本、写结果，整个过程包在一次批量提交里，
 * 结束后统一落盘；每条之间让出事件循环，让进度弹窗能够刷新。
 */
async function doBatchProcess(): Promise<void> {
  const scriptId = selectedScriptId.value;
  if (scriptId === null) {
    return;
  }

  const targets = resolveTargets();
  if (targets.length === 0) {
    alert('选中的图片组都已被排除');
    return;
  }

  processing.value = true;
  processProgressVisible.value = true;
  processedCount.value = 0;
  totalCount.value = targets.length;
  errorCount.value = 0;
  processPercent.value = 0;

  await beginBatch();
  try {
    for (const [index, group] of targets.entries()) {
      try {
        await processGroup(group, scriptId);
      } catch (error) {
        errorCount.value += 1;
        console.error(`图片组处理失败：${group.dirPath}`, error);
      }

      processedCount.value = index + 1;
      processPercent.value = Math.round(((index + 1) / targets.length) * 100);
      await delay(PROGRESS_REFRESH_MS);
    }
  } finally {
    await endBatch();
    processing.value = false;
    await loadData();
  }
}

/** 对单个图片组执行选图脚本并写入结果 */
async function processGroup(group: ImageGroupView, scriptId: number): Promise<void> {
  const files = await getImageFilesByGroup(group.id);

  // 脚本只认临时 uuid，避免让它直接依赖数据库主键
  const filePathByUuid = new Map<string, string>();
  const scriptFiles = files.map((file) => {
    const uuid = randomUUID();
    filePathByUuid.set(uuid, file.filePath);
    return {
      uuid,
      fileName: file.fileName,
      filePath: file.filePath,
      width: file.width,
      height: file.height,
      fileSize: file.fileSize ?? 0,
      ext: file.extension,
    };
  });

  const selectedUuid = await executeScript<string>(scriptId, 'select-image', {
    characterName: group.characterName,
    groupDirPath: group.dirPath,
    files: scriptFiles,
  });

  const selectedFile = filePathByUuid.get(selectedUuid);
  if (!selectedFile) {
    throw new Error('脚本返回了未知的文件标识');
  }

  await upsertProcessedImage(
    group.id, group.characterId, group.galleryId, group.dirPath, selectedFile, scriptId,
  );
}

/** 等待若干毫秒，给界面渲染的机会 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

onMounted(loadData);
</script>

<style scoped>
.process-page {
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

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
