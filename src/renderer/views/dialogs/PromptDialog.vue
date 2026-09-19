<template>
  <div class="prompt">
    <div class="prompt-header">{{ title }}</div>
    <div class="prompt-body">
      <el-input ref="inputEl" v-model="value" :placeholder="placeholder" @keyup.enter="confirm" />
      <el-button type="primary" :disabled="!value.trim()" style="width: 100%; margin-top: 20px" @click="confirm">
        确定
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { PromptInitData } from '@common/types';

const title = ref('');
const placeholder = ref('');
const value = ref('');
const inputEl = ref<{ focus: () => void } | null>(null);

/** 主进程下发的完整初始化数据，确认时要原样带回，用于区分调用方 */
let initData: PromptInitData | null = null;

function loadInitData(): void {
  ipcRenderer.once(IPC.PROMPT_INIT, (_event, data: PromptInitData) => {
    title.value = data.title;
    placeholder.value = data.placeholder ?? '';
    value.value = data.value ?? '';
    initData = data;
    nextTick(() => inputEl.value?.focus());
  });
}

function confirm(): void {
  const input = value.value.trim();
  if (!input || !initData) {
    return;
  }

  ipcRenderer.invoke(IPC.PROMPT_CONFIRM, { ...initData, value: input });
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

.prompt {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #1e1f22;
  color: #d8dadd;
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

.prompt-header {
  height: 36px;
  line-height: 36px;
  padding: 0 16px;
  font-size: 16px;
  font-weight: 400;
  color: #eceef1;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.prompt-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 32px 24px;
  -webkit-app-region: no-drag;
}
</style>
