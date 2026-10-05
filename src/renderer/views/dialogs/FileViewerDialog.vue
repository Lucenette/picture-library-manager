<template>
  <div class="file-viewer">
    <div class="fv-header">图片组文件：{{ groupName }}</div>
    <div class="fv-body">
      <el-table :data="files">
        <el-table-column label="预览" width="80">
          <template #default="{ row }">
            <img
              v-if="row.thumbnail"
              class="fv-preview"
              :src="row.thumbnail"
              :alt="row.fileName"
              @click="openViewer(row)"
            />
            <span v-else style="font-size: 24px">🖼</span>
          </template>
        </el-table-column>
        <el-table-column label="相对路径" min-width="280" show-overflow-tooltip sortable :sort-method="comparePath">
          <template #default="{ row }">{{ relativePath(row) }}</template>
        </el-table-column>
        <el-table-column prop="width" label="尺寸" width="120" sortable>
          <template #default="{ row }">{{ row.width ?? 0 }} × {{ row.height ?? 0 }}</template>
        </el-table-column>
        <el-table-column prop="fileSize" label="大小" width="100" sortable>
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
import { ipcRenderer } from 'electron';
import { onMounted, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { FileViewerInitData, ImageFile, ViewerOpenRequest } from '@common/types';

const files = ref<ImageFile[]>([]);
const groupId = ref(0);
const groupName = ref('');
const groupDirPath = ref('');

/** 进窗口后自己去主进程取初始化数据 */
async function loadInitData(): Promise<void> {
  const data = (await ipcRenderer.invoke(IPC.FILE_VIEWER_INIT)) as FileViewerInitData | null;
  if (!data) {
    return;
  }
  files.value = data.files;
  groupId.value = data.groupId;
  groupName.value = data.groupName;
  groupDirPath.value = data.groupDirPath;
}

/** 相对图片组目录展示，避免整条绝对路径占满列宽 */
function relativePath(file: ImageFile): string {
  return file.filePath.replace(groupDirPath.value, '').replace(/^[\\/]/, '');
}

function comparePath(left: ImageFile, right: ImageFile): number {
  return relativePath(left).localeCompare(relativePath(right));
}

function formatSize(bytes: number | null): string {
  if (bytes === null) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 选定当前图片作为该图片组的处理结果 */
function pick(file: ImageFile): void {
  void ipcRenderer.invoke(IPC.FILE_VIEWER_SELECT, file.filePath);
  window.close();
}

function openViewer(target: ImageFile): void {
  const request: ViewerOpenRequest = {
    source: { kind: 'group', groupId: groupId.value, startId: target.id },
    title: `${groupName.value} - ${target.fileName}`,
  };
  void ipcRenderer.invoke(IPC.VIEWER_OPEN, request);
}

onMounted(loadInitData);
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.file-viewer {
  height: 100vh;
  overflow: hidden;
  background: var(--app-bg-page);
  color: var(--app-text-regular);
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

.fv-header {
  height: 36px;
  line-height: 36px;
  padding: 0 var(--app-space-16);
  font-size: var(--app-font-md);
  color: var(--app-text-primary);
  -webkit-app-region: drag;
}

.fv-body {
  height: calc(100vh - 36px);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.fv-body :deep(.el-table) {
  height: 100%;
}

.fv-preview {
  width: 50px;
  height: 50px;
  object-fit: cover;
  border-radius: var(--app-radius-4);
  cursor: pointer;
}
</style>
