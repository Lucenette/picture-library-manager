<template>
  <div class="scan-config">
    <div class="config-header">扫描配置</div>
    <div class="config-body">
      <p class="source-name">来源：{{ sourceName }}</p>
      <p v-if="sourceCount > 1" class="source-name">共 {{ sourceCount }} 个来源</p>

      <DropdownControl v-model="scriptId" :items="scripts" placeholder="目录结构识别脚本" />

      <el-button type="primary" :disabled="!scriptId" style="width: 100%" @click="confirm">
        开始扫描
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ipcRenderer } from 'electron';
import { onMounted, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { ScanConfigInitData, ScanConfigResult, ScriptOption } from '@common/types';

import DropdownControl from '@/components/DropdownControl.vue';

const scriptId = ref<number | null>(null);
const scripts = ref<ScriptOption[]>([]);
const sourceName = ref('');
const sourceCount = ref(1);
const sourceIds = ref<number[]>([]);

/** 进窗口后自己去主进程取初始化数据 */
async function loadInitData(): Promise<void> {
  const data = (await ipcRenderer.invoke(IPC.SCAN_CONFIG_INIT)) as ScanConfigInitData | null;
  if (!data) {
    return;
  }
  scripts.value = data.scripts;
  sourceName.value = data.sourceName;
  sourceCount.value = data.sourceCount;
  sourceIds.value = data.sourceIds;
}

async function confirm(): Promise<void> {
  if (!scriptId.value) {
    return;
  }

  const result: ScanConfigResult = {
    sourceIds: [...sourceIds.value],
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
  background: var(--app-bg-page);
  color: var(--app-text-regular);
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

.config-header {
  height: 36px;
  line-height: 36px;
  padding: 0 16px;
  font-size: 16px;
  font-weight: 400;
  color: var(--app-text-primary);
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

.source-name {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--app-text-secondary);
}

.config-body .el-button {
  margin-top: 20px;
}
</style>
