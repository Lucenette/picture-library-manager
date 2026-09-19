<template>
  <div class="gallery-page">
    <div class="toolbar">
      <el-button type="primary" @click="addGallery">
        <el-icon><Plus /></el-icon> 添加图库
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
        v-loading="scanning"
        :data="pagedGalleries"
        row-key="id"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
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
            <el-button
              size="small"
              text
              type="primary"
              :loading="scanning && scanTargetId === row.id"
              @click="openScanConfig(row)"
            >
              扫描
            </el-button>
            <el-button size="small" text type="warning" @click="clearData(row)">清理数据</el-button>
            <el-button size="small" text type="danger" @click="removeGallery(row)">删除</el-button>
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
        <el-button :disabled="scanPhase !== 'done'" @click="progressVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { basename } from 'path';
import { computed, onMounted, reactive, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { Plus } from '@element-plus/icons-vue';
import { IPC } from '@common/ipcChannels';
import type {
  Gallery, ProcessScript, ScanConfigInitData, ScanConfigResult, ScanProgress, StructureOutput,
} from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';
import {
  addGallery as dbAddGallery,
  beginBatch,
  clearGalleryData,
  deleteGallery,
  endBatch,
  getAllGalleries,
  getScriptsByType,
  insertCharacter,
  insertImageFiles,
  insertImageGroup,
  updateGalleryScannedAt,
} from '@/db/database';
import { buildDirTree, generateThumbnails, scanByStructure } from '@/scanner/scanner';
import { executeScript } from '@/services/script-runner';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const galleries = ref<Gallery[]>([]);
const structScripts = ref<ProcessScript[]>([]);
const selectedIds = ref<number[]>([]);

const scanning = ref(false);
const scanTargetId = ref<number | null>(null);
const progressVisible = ref(false);
const scanPhase = ref<'dir' | 'thumb' | 'done'>('dir');
const thumbDone = ref(0);
const thumbTotal = ref(0);

const scanProgress = reactive<ScanProgress>({
  stage: 'scanning',
  charactersFound: 0,
  groupsFound: 0,
  filesFound: 0,
  currentCharacter: null,
});

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

/** 进度：目录识别阶段固定 10%，缩略图阶段占 10% ~ 100% */
const scanPercent = computed(() => {
  if (scanPhase.value === 'dir') {
    return 10;
  }
  if (scanPhase.value === 'done') {
    return 100;
  }
  if (thumbTotal.value === 0) {
    return 10;
  }
  return Math.round(10 + (thumbDone.value / thumbTotal.value) * 90);
});

const sortedGalleries = computed(() => {
  const prop = sortProp.value;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...galleries.value].sort((a, b) => a.name.localeCompare(b.name));
  }

  const direction = order === 'ascending' ? 1 : -1;
  return [...galleries.value].sort((a, b) => {
    const left = String((a as Record<string, unknown>)[prop] ?? '');
    const right = String((b as Record<string, unknown>)[prop] ?? '');
    return left.localeCompare(right) * direction;
  });
});

const pagedGalleries = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedGalleries.value.slice(start, start + pageSize.value);
});

// ------------------------------------------------------------
// 列表操作
// ------------------------------------------------------------

async function loadGalleries(): Promise<void> {
  galleries.value = await getAllGalleries();
  structScripts.value = await getScriptsByType('identify-structure');
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function onSelectionChange(rows: Gallery[]): void {
  selectedIds.value = rows.map((row) => row.id);
}

/** 通过系统对话框添加图库，支持一次选择多个目录 */
async function addGallery(): Promise<void> {
  const rootPaths: string[] = await ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR);
  if (!rootPaths?.length) {
    return;
  }

  for (const rootPath of rootPaths) {
    try {
      await dbAddGallery(basename(rootPath), rootPath);
    } catch (error) {
      // 目录已添加过会命中 root_path 唯一约束，属于预期内的忽略
      if (!(error as Error).message?.includes('UNIQUE')) {
        console.error(`添加图库失败：${rootPath}`, error);
      }
    }
  }
  await loadGalleries();
}

async function clearData(gallery: Gallery): Promise<void> {
  if (!confirm(`确定清理图库「${gallery.name}」的所有扫描数据？（不会删除原始文件）`)) {
    return;
  }
  await clearGalleryData(gallery.id);
  await loadGalleries();
}

async function removeGallery(gallery: Gallery): Promise<void> {
  if (!confirm(`确定删除图库「${gallery.name}」及其所有扫描数据？\n（不会删除原始文件）`)) {
    return;
  }
  await deleteGallery(gallery.id);
  await loadGalleries();
}

async function batchDelete(): Promise<void> {
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 个图库及其所有扫描数据？\n（不会删除原始文件）`)) {
    return;
  }
  for (const id of selectedIds.value) {
    await deleteGallery(id);
  }
  await loadGalleries();
}

// ------------------------------------------------------------
// 扫描
// ------------------------------------------------------------

function openScanConfig(gallery: Gallery): void {
  ipcRenderer.invoke(IPC.SCAN_CONFIG_OPEN, buildScanConfigPayload([gallery]));
}

function openScanConfigForSelection(): void {
  const targets = galleries.value.filter((gallery) => selectedIds.value.includes(gallery.id));
  ipcRenderer.invoke(IPC.SCAN_CONFIG_OPEN, buildScanConfigPayload(targets));
}

/** 组装扫描配置窗口的初始化数据 */
function buildScanConfigPayload(targets: Gallery[]): ScanConfigInitData {
  return {
    scripts: structScripts.value.map((script) => ({ id: script.id, name: script.name })),
    galleryIds: targets.map((gallery) => gallery.id),
    galleryName: targets.length === 1 ? targets[0].name : '',
    galleryCount: targets.length,
  };
}

useIpcListener(IPC.SCAN_CONFIG_CONFIRMED, (result: ScanConfigResult) => {
  void doScan(result.galleryIds, result.scriptId);
});

/**
 * 逐个扫描图库：结构脚本负责拆出角色与图片组，扫描器负责收集文件与缩略图。
 *
 * 整个写库过程包在一次批量提交里，结束后一次性落盘，避免扫描期间反复重写数据库。
 */
async function doScan(galleryIds: number[], scriptId: number): Promise<void> {
  for (const galleryId of galleryIds) {
    const gallery = galleries.value.find((item) => item.id === galleryId);
    if (!gallery) {
      continue;
    }

    scanning.value = true;
    scanTargetId.value = gallery.id;
    scanPhase.value = 'dir';
    thumbDone.value = 0;
    thumbTotal.value = 0;
    Object.assign(scanProgress, {
      stage: 'scanning',
      charactersFound: 0,
      groupsFound: 0,
      filesFound: 0,
      currentCharacter: null,
    });
    progressVisible.value = true;

    // 先让进度弹窗完成一次渲染，再开始占用主线程的扫描
    await new Promise((resolve) => setTimeout(resolve, 100));

    await beginBatch();
    try {
      await clearGalleryData(gallery.id);

      const tree = buildDirTree(gallery.rootPath);
      const structure = await executeScript<StructureOutput[]>(scriptId, 'identify-structure', {
        rootPath: gallery.rootPath,
        tree,
      });
      const characters = scanByStructure(
        structure,
        gallery.rootPath,
        (progress) => Object.assign(scanProgress, progress),
      );

      scanPhase.value = 'thumb';
      thumbTotal.value = scanProgress.filesFound;

      for (const character of characters) {
        const characterRecord = await insertCharacter(gallery.id, character.name, character.sourcePath);
        for (const group of character.groups) {
          const groupRecord = await insertImageGroup(
            characterRecord.id,
            group.dirName,
            group.dirPath,
            group.files.length,
          );
          if (group.files.length === 0) {
            continue;
          }

          const files = await generateThumbnails(group.files, (progress) => {
            thumbDone.value += 1;
            scanProgress.currentCharacter = `${progress.current} / ${progress.total} ${progress.currentFile}`;
          });
          await insertImageFiles(groupRecord.id, files);
        }
      }

      await updateGalleryScannedAt(gallery.id);
      scanPhase.value = 'done';
    } catch (error) {
      alert(`扫描出错：${(error as Error).message}`);
    } finally {
      await endBatch();
      scanning.value = false;
      scanTargetId.value = null;
      progressVisible.value = false;
    }

    await loadGalleries();
  }
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
