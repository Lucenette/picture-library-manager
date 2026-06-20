<template>
  <div class="process-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-select v-model="galleryFilter" placeholder="按图库" clearable filterable style="width: 140px" @change="onGalleryFilterChange">
          <el-option v-for="g in galleries" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>

        <el-select v-model="characterFilter" placeholder="按角色" clearable filterable style="width: 160px; margin-left: 8px">
          <el-option v-for="c in characterNames" :key="c" :label="c" :value="c" />
        </el-select>

        <el-select v-model="statusFilter" placeholder="状态筛选" clearable filterable style="width: 140px; margin-left: 8px">
          <el-option label="全部" value="" />
          <el-option label="未处理" value="pending" />
          <el-option label="已处理" value="processed" />
          <el-option label="已排除" value="excluded" />
        </el-select>

        <el-select v-model="selectedScriptId" placeholder="选择脚本" clearable filterable style="width: 200px; margin-left: 8px">
          <el-option v-for="s in scripts" :key="s.id" :label="s.name" :value="s.id" />
        </el-select>

        <el-button type="primary" @click="batchProcess" :disabled="!selectedScriptId || selectedIds.length === 0" style="margin-left: 8px">
          批量处理 ({{ selectedIds.length }})
        </el-button>

        <el-button @click="excludeSelected" :disabled="selectedIds.length === 0" style="margin-left: 4px">
          标记排除
        </el-button>

        <el-button @click="unexcludeSelected" :disabled="selectedIds.length === 0" style="margin-left: 4px">
          取消排除
        </el-button>
      </div>

      <div class="toolbar-right">
        <el-button @click="showScriptDialog = true">
          <el-icon><Setting /></el-icon> 脚本管理
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
      <el-table-column prop="dirName" label="图片组" min-width="200" show-overflow-tooltip sortable="custom" />
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
            <img v-if="row.thumbnail" :src="row.thumbnail" @click="openViewer(currentFiles, row)" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; cursor: pointer" />
            <span v-else style="font-size:24px">🖼</span>
          </template>
        </el-table-column>
        <el-table-column label="相对路径" min-width="280" show-overflow-tooltip sortable :sort-method="(a,b) => relPath(a).localeCompare(relPath(b))">
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

    <!-- 脚本管理弹窗 -->
    <el-dialog v-model="showScriptDialog" title="脚本管理" width="600px">
      <div style="margin-bottom: 12px">
        <el-button type="primary" size="small" @click="addScript">加载脚本文件</el-button>
      </div>
      <el-table :data="scripts" max-height="300">
        <el-table-column prop="name" label="名称" width="180" show-overflow-tooltip />
        <el-table-column prop="filePath" label="文件路径" min-width="200" show-overflow-tooltip />
        <el-table-column prop="loadedAt" label="加载时间" width="160" />
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button size="small" text @click="reloadScript(row)">重载</el-button>
            <el-button size="small" text type="danger" @click="removeScript(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="scripts.length === 0" description="还没有加载脚本" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import {
  getImageGroupsView,
  updateImageGroupStatus,
  getImageFilesByGroup,
  upsertProcessedImage,
  getAllScripts,
  getAllGalleries,
  upsertScript,
  reloadScript as dbReload,
  deleteScript,
} from '@/db/database';
import { runScript } from '@/services/script-runner';
import type { ImageGroupView, ImageGroupStatus, ImageFile, ProcessScript, Gallery } from '@common/types';

// ============================================================
// 数据
// ============================================================

const statusFilter = ref<string>('');
const galleryFilter = ref<number | undefined>(undefined);
const characterFilter = ref<string>('');
const selectedScriptId = ref<number | null>(null);
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

/** 脚本管理弹窗 */
const showScriptDialog = ref(false);

// ============================================================
// 计算
// ============================================================

const characterNames = computed(() => {
  const names = new Set(allGroups.value.map(g => g.characterName));
  return [...names].sort();
});

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
function onGalleryFilterChange(_gid?: number): void {
  characterFilter.value = '';
}

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
async function batchProcess(): Promise<void> {
  if (!selectedScriptId.value || selectedIds.value.length === 0) return;
  const targets = allGroups.value.filter(g => selectedIds.value.includes(g.id) && g.status !== 'excluded');
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

/** 添加脚本 —— Electron 原生对话框，支持多选 */
async function addScript(): Promise<void> {
  const { ipcRenderer } = require('electron');
  const paths: string[] = await ipcRenderer.invoke('dialog:openScript');
  if (!paths || paths.length === 0) return;

  const fs = require('fs');
  const path = require('path');

  for (const filePath of paths) {
    const code = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath);
    await upsertScript(name, filePath, code);
  }
  scripts.value = await getAllScripts();
}

/** 重载脚本 */
async function reloadScript(script: ProcessScript): Promise<void> {
  const fs = require('fs');
  try {
    const code = fs.readFileSync(script.filePath, 'utf-8');
    await dbReload(script.filePath, code);
    scripts.value = await getAllScripts();
  } catch (e: any) { alert(`重载失败: ${e.message}`); }
}

/** 删除脚本 */
async function removeScript(script: ProcessScript): Promise<void> {
  if (!confirm(`确定删除脚本「${script.name}」？`)) return;
  await deleteScript(script.id);
  scripts.value = await getAllScripts();
  if (selectedScriptId.value === script.id) selectedScriptId.value = null;
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

.toolbar-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

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
