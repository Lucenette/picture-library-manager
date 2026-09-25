<template>
  <div class="scan-config">
    <div class="config-header">扫描配置</div>
    <div class="config-body">
      <p class="gallery-name">来源：{{ galleryName }}</p>
      <p v-if="galleryCount > 1" class="gallery-name">共 {{ galleryCount }} 个来源</p>

      <DropdownControl v-model="scriptId" :items="scripts" placeholder="目录结构识别脚本" />

      <el-button type="primary" :disabled="!scriptId" style="width: 100%" @click="confirm">
        开始扫描
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ScanConfigInitData, ScanConfigResult, ScriptOption } from '@common/types';
import DropdownControl from '@/components/DropdownControl.vue';

const scriptId = ref<number | null>(null);
const scripts = ref<ScriptOption[]>([]);
const galleryName = ref('');
const galleryCount = ref(1);
const galleryIds = ref<number[]>([]);

/** 进窗口后自己去主进程取初始化数据 */
async function loadInitData(): Promise<void> {
  const data = (await ipcRenderer.invoke(IPC.SCAN_CONFIG_INIT)) as ScanConfigInitData | null;
  if (!data) {
    return;
  }
  scripts.value = data.scripts;
  galleryName.value = data.galleryName;
  galleryCount.value = data.galleryCount;
  galleryIds.value = data.galleryIds;
}

async function confirm(): Promise<void> {
  if (!scriptId.value) {
    return;
  }

  const result: ScanConfigResult = {
    galleryIds: [...galleryIds.value],
    scriptId: Number(scriptId.value),
  };
  await ipcRenderer.invoke(IPC.SCAN_CONFIG_CONFIRM, result);
  window.close();
}

onMounted(loadInitData);
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.scan-config {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1e1f22;
  color: #d8dadd;
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

.config-header {
  height: 36px;
  line-height: 36px;
  padding: 0 16px;
  font-size: 16px;
  font-weight: 400;
  color: #eceef1;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.config-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 32px 24px;
  -webkit-app-region: no-drag;
}

.gallery-name {
  margin-bottom: 16px;
  font-size: 13px;
  color: #b4b6ba;
}

.config-body .el-button {
  margin-top: 20px;
}
</style>
