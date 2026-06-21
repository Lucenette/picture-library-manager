<template>
  <div class="gallery-page">
    <div class="toolbar">
      <el-button type="primary" @click="addGallery">
        <el-icon><Plus /></el-icon> 添加图库
      </el-button>
      <el-button type="success" @click="batchScan" :disabled="selectedIds.length === 0">
        批量扫描 ({{ selectedIds.length }})
      </el-button>
      <el-button type="danger" @click="batchDelete" :disabled="selectedIds.length === 0">
        批量删除 ({{ selectedIds.length }})
      </el-button>
    </div>

    <div class="table-wrap">
      <el-table
        :data="pagedGalleries"
        v-loading="scanning"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
        row-key="id"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column prop="name" label="图库名称" min-width="200" sortable="custom" />
        <el-table-column prop="rootPath" label="路径" min-width="350" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="scannedAt" label="最近扫描" width="170" sortable="custom">
          <template #default="{ row }">
            {{ row.scannedAt || '未扫描' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="scanGallery(row)" :loading="scanning && scanTargetId === row.id">
              扫描
            </el-button>
            <el-button size="small" text type="warning" @click="clearData(row)">
              清理数据
            </el-button>
            <el-button size="small" text type="danger" @click="removeGallery(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="sortedGalleries.length"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>

    <!-- 扫描进度 -->
    <el-dialog v-model="progressVisible" title="扫描进度" width="400px" :close-on-click-modal="false">
      <div class="progress-content">
        <el-progress :percentage="scanPercent" :indeterminate="scanPhase === 'dir'" />
        <div class="progress-stats">
          <p>角色数：{{ scanProgress.charactersFound }}</p>
          <p>图片组：{{ scanProgress.groupsFound }}</p>
          <p>文件数：{{ scanProgress.filesFound }}</p>
          <p v-if="scanProgress.currentCharacter">当前：{{ scanProgress.currentCharacter }}</p>
        </div>
      </div>
      <template #footer>
        <el-button @click="progressVisible = false" :disabled="scanPhase !== 'done'">
          关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { IPC } from '@common/ipcChannels';
import { ref, reactive, onMounted, computed } from 'vue';
import { ipcRenderer } from 'electron';
import { Plus } from '@element-plus/icons-vue';
import { getAllGalleries, addGallery as dbAdd, deleteGallery, clearGalleryData, updateGalleryScannedAt, getScriptsByType } from '@/db/database';
import {
  insertCharacter,
  insertImageGroup,
  insertImageFiles,
} from '@/db/database';
import { executeScript } from '@/services/script-runner';
import { buildDirTree, scanByStructure, generateThumbnails } from '@/scanner/scanner';
import type { Gallery, ScanProgress, ProcessScript, StructureOutput } from '@common/types';

const galleries = ref<Gallery[]>([]);
const selectedIds = ref<number[]>([]);
const structScripts = ref<ProcessScript[]>([]);
const scanning = ref(false);
const scanTargetId = ref<number | null>(null);
const progressVisible = ref(false);
const scanProgress = reactive<ScanProgress>({
  stage: 'scanning',
  charactersFound: 0,
  groupsFound: 0,
  filesFound: 0,
  currentCharacter: null,
});
/** 缩略图阶段进度：条满 10%~100% */
const thumbCurrent = ref(0);
const thumbTotal = ref(0);
const scanPhase = ref<'dir' | 'thumb' | 'done'>('dir');
const scanPercent = computed(() => {
  if (scanPhase.value === 'dir') return 10;
  if (scanPhase.value === 'done') return 100;
  return thumbTotal.value > 0 ? Math.round(10 + (thumbCurrent.value / thumbTotal.value) * 90) : 10;
});

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

const sortedGalleries = computed(() => {
  const prop = sortProp.value;
  const order = sortOrder.value;
  if (!prop || !order) {
    // 默认：按图库名称升序
    return [...galleries.value].sort((a, b) => a.name.localeCompare(b.name));
  }
  const dir = order === 'ascending' ? 1 : -1;
  return [...galleries.value].sort((a, b) => {
    const va = (a as any)[prop] ?? '';
    const vb = (b as any)[prop] ?? '';
    return String(va).localeCompare(String(vb)) * dir;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(sortedGalleries.value.length / pageSize.value)));

const pagedGalleries = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedGalleries.value.slice(start, start + pageSize.value);
});

/** 加载图库列表 */
async function loadGalleries(): Promise<void> {
  galleries.value = await getAllGalleries();
  structScripts.value = await getScriptsByType('identify-structure');
}

/**
 * 添加图库 —— Electron 原生对话框选择文件夹
 */
async function addGallery(): Promise<void> {
  const paths: string[] = await ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR);
  if (!paths || paths.length === 0) return;

  for (const rootPath of paths) {
    const rootName = rootPath.split('\\').pop() || rootPath;
    try {
      await dbAdd(rootName, rootPath);
    } catch (e: any) {
      if (!e.message?.includes('UNIQUE')) {
        console.error(`添加失败: ${rootName}`, e.message);
      }
    }
  }
  await loadGalleries();
}

/** 弹出原生扫描配置窗口 */
function scanGallery(gallery: Gallery): void {
  const { ipcRenderer } = require('electron');
  ipcRenderer.invoke(IPC.SCAN_CONFIG_OPEN, {
    scripts: structScripts.value.map(s => ({ id: s.id, name: s.name })),
    galleryIds: [gallery.id],
    galleryName: gallery.name,
    galleryCount: 1,
  });
}

function batchScan(): void {
  const { ipcRenderer } = require('electron');
  const targets = galleries.value.filter(g => selectedIds.value.includes(g.id));
  ipcRenderer.invoke(IPC.SCAN_CONFIG_OPEN, {
    scripts: structScripts.value.map(s => ({ id: s.id, name: s.name })),
    galleryIds: targets.map(g => g.id),
    galleryName: targets.length === 1 ? targets[0].name : '',
    galleryCount: targets.length,
  });
}

/** 扫描配置确认回调 */
onMounted(() => {
  const { ipcRenderer } = require('electron');
  ipcRenderer.on(IPC.SCAN_CONFIG_CONFIRMED, (_event: any, data: any) => {
    doScan(data.galleryIds, data.scriptId);
  });
});

/** 执行扫描 */
async function doScan(galleryIds: number[], scriptId: number): Promise<void> {
  for (const id of galleryIds) {
    const gallery = galleries.value.find(g => g.id === id);
    if (!gallery) continue;
    scanning.value = true;
    scanTargetId.value = gallery.id;
    scanPhase.value = 'dir';
    scanProgress.charactersFound = 0; scanProgress.groupsFound = 0; scanProgress.filesFound = 0;
    scanProgress.currentCharacter = null;
    thumbCurrent.value = 0; thumbTotal.value = 0;
    progressVisible.value = true;

    await new Promise<void>(resolve => {
      setTimeout(async () => {
        try {
          await clearGalleryData(gallery.id);
          const tree = buildDirTree(gallery.rootPath);
          const structure = await executeScript(scriptId, 'identify-structure', { rootPath: gallery.rootPath, tree });
          const characters = scanByStructure(structure, gallery.rootPath, (progress) => { Object.assign(scanProgress, progress); });
          scanPhase.value = 'thumb';
          thumbTotal.value = scanProgress.filesFound;
          thumbCurrent.value = 0;

          for (const char of characters) {
            const charRecord = await insertCharacter(gallery.id, char.name, char.sourcePath);
            for (const group of char.groups) {
              const groupRecord = await insertImageGroup(charRecord.id, group.dirName, group.dirPath, group.files.length);
              if (group.files.length > 0) {
                const filesWithThumb = await generateThumbnails(group.files, (tp) => { thumbCurrent.value += 1; scanProgress.currentCharacter = `${thumbCurrent.value}/${thumbTotal.value} ${tp.currentFile}`; });
                await insertImageFiles(groupRecord.id, filesWithThumb.map((f) => ({ fileName: f.fileName, filePath: f.filePath, fileSize: f.fileSize, width: f.width, height: f.height, extension: f.extension, thumbnail: f.thumbnail })));
              }
            }
          }
          scanPhase.value = 'done';
          await updateGalleryScannedAt(gallery.id);
          await loadGalleries();
          progressVisible.value = false;
        } catch (e: any) { alert(`扫描出错: ${e.message}`); }
        finally { scanning.value = false; scanTargetId.value = null; resolve(); }
      }, 100);
    });
  }
}

function onSelectionChange(rows: Gallery[]): void {
  selectedIds.value = rows.map(r => r.id);
}

/** 批量删除 */
async function batchDelete(): Promise<void> {
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 个图库及其所有扫描数据？\n（不会删除原始文件）`)) return;
  for (const id of selectedIds.value) {
    await deleteGallery(id);
  }
  await loadGalleries();
}

/** 清理图库数据 */
async function clearData(gallery: Gallery): Promise<void> {
  if (!confirm(`确定清理图库「${gallery.name}」的所有扫描数据？（不会删除原始文件）`)) return;
  await clearGalleryData(gallery.id);
  await loadGalleries();
}

/** 删除图库 */
async function removeGallery(gallery: Gallery): Promise<void> {
  if (!confirm(`确定删除图库「${gallery.name}」及其所有扫描数据？\n（不会删除原始文件）`)) return;
  await deleteGallery(gallery.id);
  await loadGalleries();
}

onMounted(loadGalleries);
</script>

<style scoped>
.gallery-page {
  padding: 0 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex; align-items: center; gap: 10px;
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

.progress-stats {
  margin-top: 16px;
  line-height: 1.8;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
