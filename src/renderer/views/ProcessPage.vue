<template>
  <div class="process-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterCats" :order="filterOrder" />
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="showBatchDialog = true">
          批量处理 ({{ selectedIds.length || filteredGroups.length }})
        </el-button>
        <el-button @click="excludeSelected" :disabled="selectedIds.length === 0">
          标记排除
        </el-button>
        <el-button @click="unexcludeSelected" :disabled="selectedIds.length === 0">
          取消排除
        </el-button>
      </div>
    </div>

    <div class="table-wrap">
    <el-table
      :data="pagedGroups"
      style="width: 100%"
      @selection-change="onSelectionChange"
      @sort-change="onSortChange"
      v-loading="processing"
      row-key="id"
    >
      <el-table-column type="selection" width="45" />
      <el-table-column prop="galleryName" label="图库" width="140" show-overflow-tooltip sortable="custom" />
      <el-table-column prop="characterName" label="角色" width="160" show-overflow-tooltip sortable="custom" />
      <el-table-column prop="dirName" label="图片组" min-width="140" show-overflow-tooltip sortable="custom" />
      <el-table-column prop="dirPath" label="路径" min-width="360" show-overflow-tooltip sortable="custom" />
      <el-table-column prop="fileCount" label="文件数" width="90" align="center" sortable="custom" />
      <el-table-column label="状态" width="100" align="center" sortable="custom" prop="status">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
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

    <!-- 选择脚本弹窗 -->
    <el-dialog v-model="showBatchDialog" title="批量处理" width="400px">
      <el-select v-model="selectedScriptId" placeholder="选择脚本" filterable style="width: 100%">
        <el-option v-for="s in scripts" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>
      <template #footer>
        <el-button @click="showBatchDialog = false">取消</el-button>
        <el-button type="primary" @click="doBatchProcess" :disabled="!selectedScriptId">开始处理</el-button>
      </template>
    </el-dialog>

    <!-- 处理进度 -->
    <el-dialog v-model="processProgressVisible" title="处理进度" width="400px" :close-on-click-modal="false">
      <el-progress :percentage="processPercent" />
      <p style="margin-top: 12px">
        已处理 {{ processedCount }} / {{ totalCount }}，错误 {{ errorCount }}
      </p>
      <template #footer>
        <el-button @click="processProgressVisible = false" :disabled="processing">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 查看文件弹窗 -->
    <el-dialog v-model="fileDialogVisible" :title="`图片组文件: ${currentGroup?.dirName}`" width="800px" class="file-dialog">
      <el-table :data="currentFiles" max-height="400">
        <el-table-column label="预览" width="80">
          <template #default="{ row }">
            <img v-if="row.thumbnail" :src="row.thumbnail" :alt="row.fileName" @click="openViewer(currentFiles, row)" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; cursor: pointer" />
            <span v-else style="font-size:24px">🖼</span>
          </template>
        </el-table-column>
        <el-table-column label="相对路径" min-width="280" show-overflow-tooltip sortable :sort-method="(a: ImageFile,b: ImageFile) => relPath(a).localeCompare(relPath(b))">
          <template #default="{ row }">
            {{ relPath(row) }}
          </template>
        </el-table-column>
        <el-table-column label="尺寸" width="120" prop="width" sortable>
          <template #default="{ row }">
            {{ row.width }} × {{ row.height }}
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100" prop="fileSize" sortable>
          <template #default="{ row }">
            {{ formatSize(row.fileSize) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="manualConfirm(row)">选这个</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterSection } from '@/components/CategorySearch.types';
import {
  getImageGroupsView,
  updateImageGroupStatus,
  getImageFilesByGroup,
  upsertProcessedImage,
  getAllScripts,
  getAllGalleries,
} from '@/db/database';
import { runScript } from '@/services/script-runner';
import type {ImageGroupView, ImageGroupStatus, ImageFile, Gallery, ProcessScript} from '@common/types';

// ============================================================
// 数据
// ============================================================

const filterOrder = ref<string[]>([]); // 记录添加顺序
const pathFilter = ref<string>('');
const statusFilter = ref<string>('');
const galleryFilter = ref<number | undefined>(undefined);
const characterFilter = ref<string>('');

const galleryItems = computed(() => galleries.value.map(g => ({ label: g.name, value: String(g.id) })));
const characterItems = computed(() => [...new Set(allGroups.value.map(g => g.characterName))].sort().map(n => ({ label: n, value: n })));
const statusItems = [
  { label: '未处理', value: 'pending' },
  { label: '已处理', value: 'processed' },
  { label: '已排除', value: 'excluded' },
];

const filterCats = computed<FilterSection[]>(() => [
  {
    key: 'gallery', label: '图库',
    value: galleryFilter.value ? String(galleryFilter.value) : '',
    display: galleryFilter.value ? galleries.value.find(g => g.id === galleryFilter.value)?.name || '' : '',
    items: galleryItems.value,
    onSelect: (v: string) => { galleryFilter.value = Number(v); onGalleryFilterChange(); page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'gallery'), 'gallery']; },
    onClear: () => { galleryFilter.value = undefined; onGalleryFilterChange(); page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'gallery'); },
  },
  {
    key: 'character', label: '角色',
    value: characterFilter.value,
    display: characterFilter.value || '',
    items: characterItems.value,
    onSelect: (v: string) => { characterFilter.value = v; page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'character'), 'character']; },
    onClear: () => { characterFilter.value = ''; page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'character'); },
  },
  {
    key: 'path', label: '路径',
    value: pathFilter.value,
    display: pathFilter.value || '',
    items: [],
    onSelect: (v: string) => { pathFilter.value = v; page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'path'), 'path']; },
    onClear: () => { pathFilter.value = ''; page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'path'); },
  },
  {
    key: 'status', label: '状态',
    value: statusFilter.value,
    display: statusItems.find(s => s.value === statusFilter.value)?.label || '',
    items: statusItems,
    onSelect: (v: string) => { statusFilter.value = v; page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'status'), 'status']; },
    onClear: () => { statusFilter.value = ''; page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'status'); },
  },
]);
const selectedScriptId = ref<number | null>(null);
const showBatchDialog = ref(false);
const selectedIds = ref<number[]>([]);
const allGroups = ref<ImageGroupView[]>([]);
const scripts = ref<ProcessScript[]>([]);
const galleries = ref<Gallery[]>([]);
const processing = ref(false);
const processProgressVisible = ref(false);
const processPercent = ref(0);
const processedCount = ref(0);
const totalCount = ref(0);
const errorCount = ref(0);

/** 分页 */
const page = ref(1);
const pageSize = ref(20);

/** 排序 */
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

/** 文件查看弹窗 */
const fileDialogVisible = ref(false);
const currentGroup = ref<ImageGroupView | null>(null);
const currentFiles = ref<ImageFile[]>([]);


// ============================================================
// 计算
// ============================================================


const filteredGroups = computed(() => {
  let list = allGroups.value;

  if (statusFilter.value) {
    list = list.filter(g => g.status === statusFilter.value);
  }
  if (galleryFilter.value) {
    list = list.filter(g => g.galleryId === galleryFilter.value);
  }
  if (characterFilter.value) {
    list = list.filter(g => g.characterName === characterFilter.value);
  }
  if (pathFilter.value) {
    const kw = pathFilter.value.toLowerCase();
    list = list.filter(g => g.dirPath.toLowerCase().includes(kw));
  }

  // 排序
  const prop = sortProp.value as keyof ImageGroupView | null;
  const order = sortOrder.value;
  if (!prop || !order) {
    // 默认：图库名 → 角色名 → 图片组
    list = [...list].sort((a, b) => {
      let cmp = a.galleryName.localeCompare(b.galleryName);
      if (cmp !== 0) return cmp;
      cmp = a.characterName.localeCompare(b.characterName);
      return cmp !== 0 ? cmp : a.dirName.localeCompare(b.dirName);
    });
  } else {
    const dir = order === 'ascending' ? 1 : -1;
    list = [...list].sort((a, b) => {
      const va = a[prop] ?? '';
      const vb = b[prop] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  return list;
});

const pagedGroups = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredGroups.value.slice(start, start + pageSize.value);
});

// ============================================================
// 方法
// ============================================================

async function loadData(): Promise<void> {
  allGroups.value = await getImageGroupsView();
  scripts.value = await getAllScripts();
  galleries.value = await getAllGalleries();
}

/** 图库筛选变化时清角色筛选 */
function onGalleryFilterChange(): void {}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function statusTagType(status: ImageGroupStatus): 'info' | 'success' | 'danger' {
  if (status === 'processed') return 'success';
  if (status === 'excluded') return 'danger';
  return 'info';
}

function statusLabel(status: ImageGroupStatus): string {
  if (status === 'processed') return '已处理';
  if (status === 'excluded') return '已排除';
  return '未处理';
}

function onSelectionChange(rows: ImageGroupView[]): void {
  selectedIds.value = rows.map((r) => r.id);
}

async function openViewer(fileList: ImageFile[], target: ImageFile): Promise<void> {
  const { ipcRenderer } = require('electron');
  const idx = fileList.indexOf(target);
  const files = fileList.map(f => ({
    filePath: f.filePath,
    fileName: f.fileName,
    relativePath: relPath(f),
    fileSize: f.fileSize,
    width: f.width,
    height: f.height,
    thumbnail: f.thumbnail,
  }));
  await ipcRenderer.invoke('viewer:open', { files, index: idx >= 0 ? idx : 0 });
}

function relPath(f: ImageFile): string {
  return f.filePath.replace(currentGroup.value?.dirPath || '', '').replace(/^[\\/]/, '');
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** 查看图片组下的文件 */
function viewFiles(group: ImageGroupView): void {
  currentGroup.value = group;
  getImageFilesByGroup(group.id).then(files => { currentFiles.value = files; });
  fileDialogVisible.value = true;
}

/** 手动确认选择文件 */
async function manualConfirm(file: ImageFile): Promise<void> {
  if (!currentGroup.value) return;
  const g = currentGroup.value;
  try {
    await upsertProcessedImage(g.id, g.characterId, g.galleryId, g.dirPath, file.filePath, null);
    await loadData();
    fileDialogVisible.value = false;
  } catch (e: any) { alert(`确认失败: ${e.message}`); }
}

/** 排除/恢复 */
async function toggleExclude(group: ImageGroupView): Promise<void> {
  const newStatus: ImageGroupStatus = group.status === 'excluded' ? 'pending' : 'excluded';
  await updateImageGroupStatus(group.id, newStatus);
  await loadData();
}

/** 批量标记排除 */
async function excludeSelected(): Promise<void> {
  for (const id of selectedIds.value) {
    await updateImageGroupStatus(id, 'excluded');
  }
  await loadData();
}

/** 批量取消排除 */
async function unexcludeSelected(): Promise<void> {
  for (const id of selectedIds.value) {
    await updateImageGroupStatus(id, 'pending');
  }
  await loadData();
}

/** 批量处理 */
async function doBatchProcess(): Promise<void> {
  if (!selectedScriptId.value) return;
  showBatchDialog.value = false;
  const targets = selectedIds.value.length > 0
    ? allGroups.value.filter(g => selectedIds.value.includes(g.id) && g.status !== 'excluded')
    : filteredGroups.value.filter(g => g.status !== 'excluded');
  if (targets.length === 0) { alert('选中的图片组都已被排除'); return; }

  processing.value = true;
  processProgressVisible.value = true;
  processedCount.value = 0;
  totalCount.value = targets.length;
  errorCount.value = 0;
  processPercent.value = 0;

  let i = 0;
  async function next(): Promise<void> {
    if (i >= targets.length) { processing.value = false; await loadData(); return; }
    const group = targets[i]; i++;
    const result = await runScript(selectedScriptId.value!, group.dirPath);

    if (result.success && result.selectedFile) {
      try { await upsertProcessedImage(group.id, group.characterId, group.galleryId, group.dirPath, result.selectedFile, selectedScriptId.value); }
      catch { errorCount.value++; }
    } else { errorCount.value++; console.error(`[${group.dirName}] ${result.error}`); }

    processedCount.value = i;
    processPercent.value = Math.round((i / targets.length) * 100);
    setTimeout(next, 50);
  }
  setTimeout(next, 50);
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
  gap: 8px;
  flex-shrink: 0;
}
.toolbar-left { display: flex; align-items: center; flex: 1; }
.toolbar-right { display: flex; align-items: center; gap: 4px; }

.file-dialog :deep(.el-dialog__body) {
  padding: 12px 16px;
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
