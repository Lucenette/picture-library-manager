<template>
  <div class="file-viewer">
    <div class="fv-header">图片组文件: {{ groupName }}</div>
    <div class="fv-body">
      <el-table :data="files">
        <el-table-column label="预览" width="80">
          <template #default="{ row }">
            <img v-if="row.thumbnail" :src="row.thumbnail" :alt="row.fileName" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; cursor: pointer" @click="openViewer(row)" />
            <span v-else style="font-size:24px">🖼</span>
          </template>
        </el-table-column>
        <el-table-column label="相对路径" min-width="280" show-overflow-tooltip sortable :sort-method="(a: any, b: any) => relPath(a).localeCompare(relPath(b))">
          <template #default="{ row }">
            {{ relPath(row) }}
          </template>
        </el-table-column>
        <el-table-column label="尺寸" width="120" prop="width" sortable>
          <template #default="{ row }">{{ row.width }} × {{ row.height }}</template>
        </el-table-column>
        <el-table-column label="大小" width="100" prop="fileSize" sortable>
          <template #default="{ row }">{{ formatSize(row.fileSize) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="pick(row)">选这个</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IPC } from '@common/ipcChannels';
const { ipcRenderer } = require('electron');

interface FileInfo { fileName: string; filePath: string; thumbnail: string|null; width: number|null; height: number|null; fileSize: number; }

const files = ref<FileInfo[]>([]);
const groupName = ref('');
const groupDirPath = ref('');

onMounted(() => {
  ipcRenderer.once(IPC.FILE_VIEWER_INIT, (_e: any, data: any) => {
    files.value = data.files;
    groupName.value = data.groupName;
    groupDirPath.value = data.groupDirPath;
  });
});

function relPath(f: FileInfo): string {
  return f.filePath.replace(groupDirPath.value, '').replace(/^[\\/]/, '');
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function pick(row: FileInfo): void {
  ipcRenderer.invoke(IPC.FILE_VIEWER_SELECT, row.filePath);
  window.close();
}

function openViewer(row: FileInfo): void {
  const idx = files.value.indexOf(row);
  ipcRenderer.invoke(IPC.VIEWER_OPEN, {
    files: files.value.map(f => ({
      filePath: f.filePath, fileName: f.fileName, relativePath: relPath(f),
      fileSize: f.fileSize, width: f.width, height: f.height, thumbnail: f.thumbnail,
    })),
    index: idx >= 0 ? idx : 0,
  });
}
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.file-viewer { height: 100vh; overflow: hidden; background: #1e1f22; color: #d8dadd; font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif; }
.fv-header { height: 36px; line-height: 36px; padding: 0 16px; font-size: 14px; color: #eceef1; -webkit-app-region: drag; }
.fv-body { height: calc(100vh - 36px); overflow: hidden; -webkit-app-region: no-drag; }
.fv-body :deep(.el-table) { height: 100%; }
</style>
