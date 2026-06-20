<template>
  <div class="gallery-page">
    <div class="toolbar">
      <el-button type="primary" @click="addGallery">
        <el-icon><Plus /></el-icon> 添加图库
      </el-button>
    </div>

    <el-table
      :data="sortedGalleries"
      style="width: 100%"
      v-loading="scanning"
      @sort-change="onSortChange"
    >
      <el-table-column prop="name" label="图库名称" min-width="200" sortable="custom" />
      <el-table-column prop="rootPath" label="路径" min-width="350" show-overflow-tooltip sortable="custom" />
      <el-table-column prop="scannedAt" label="最近扫描" width="170" sortable="custom">
        <template #default="{ row }">
          {{ row.scannedAt || '未扫描' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="success" @click="scanGallery(row)" :loading="scanning && scanTargetId === row.id">
            扫描
          </el-button>
          <el-button size="small" type="danger" @click="removeGallery(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="galleries.length === 0 && !scanning" description="还没有添加图库，点击上方按钮添加" />

    <!-- 扫描进度 -->
    <el-dialog v-model="progressVisible" title="扫描进度" width="400px" :close-on-click-modal="false">
      <div class="progress-content">
        <el-progress :percentage="100" :indeterminate="scanProgress.stage === 'scanning'" />
        <div class="progress-stats">
          <p>角色数：{{ scanProgress.charactersFound }}</p>
          <p>图片组：{{ scanProgress.groupsFound }}</p>
          <p>文件数：{{ scanProgress.filesFound }}</p>
          <p v-if="scanProgress.currentCharacter">当前：{{ scanProgress.currentCharacter }}</p>
        </div>
      </div>
      <template #footer>
        <el-button @click="progressVisible = false" :disabled="scanProgress.stage === 'scanning'">
          关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ipcRenderer } from 'electron';
import { Plus } from '@element-plus/icons-vue';
import { getAllGalleries, addGallery as dbAdd, deleteGallery, updateGalleryScannedAt } from '@/db/database';
import {
  insertCharacter,
  insertImageGroup,
  insertImageFiles,
} from '@/db/database';
import { scanGallery as doScan } from '@/scanner/scanner';
import type { Gallery, ScanProgress } from '../../common/types';

const galleries = ref<Gallery[]>([]);
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

/** 加载图库列表 */
async function loadGalleries(): Promise<void> {
  galleries.value = await getAllGalleries();
}

/**
 * 添加图库 —— Electron 原生对话框选择文件夹
 */
async function addGallery(): Promise<void> {
  const result = await ipcRenderer.invoke('dialog:openDir');
  if (!result) return;

  const rootPath = result as string;
  const rootName = rootPath.split('\\').pop() || rootPath;

  try {
    await dbAdd(rootName, rootPath);
    await loadGalleries();
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      alert('该图库已添加过');
    } else {
      alert(`添加失败: ${e.message}`);
    }
  }
}

/** 扫描图库 */
async function scanGallery(gallery: Gallery): Promise<void> {
  scanning.value = true;
  scanTargetId.value = gallery.id;
  scanProgress.stage = 'scanning';
  scanProgress.charactersFound = 0;
  scanProgress.groupsFound = 0;
  scanProgress.filesFound = 0;
  scanProgress.currentCharacter = null;
  progressVisible.value = true;

  // 使用 setTimeout 让 UI 先更新
  setTimeout(async () => {
    try {
      const characters = doScan(gallery.rootPath, (progress) => {
        Object.assign(scanProgress, progress);
      });

      for (const char of characters) {
        const charRecord = await insertCharacter(gallery.id, char.name, char.sourcePath);
        for (const group of char.groups) {
          const groupRecord = await insertImageGroup(charRecord.id, group.dirName, group.dirPath, group.files.length);
          if (group.files.length > 0) {
            await insertImageFiles(groupRecord.id, group.files.map((f) => ({
              fileName: f.fileName, filePath: f.filePath, fileSize: f.fileSize,
              width: f.width, height: f.height, extension: f.extension,
            })));
          }
        }
      }

      await updateGalleryScannedAt(gallery.id);
      await loadGalleries();
      progressVisible.value = false;
    } catch (e: any) {
      alert(`扫描出错: ${e.message}`);
    } finally {
      scanning.value = false;
      scanTargetId.value = null;
    }
  }, 100);
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
}

.toolbar {
  margin-bottom: 16px;
}

.progress-stats {
  margin-top: 16px;
  line-height: 1.8;
}
</style>
