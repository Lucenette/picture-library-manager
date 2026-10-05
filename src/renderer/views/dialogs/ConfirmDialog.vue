<template>
  <div ref="rootEl" class="confirm" tabindex="0" @keydown.esc="onEscape">
    <div class="confirm-header">{{ title }}</div>
    <div class="confirm-body">
      <p class="confirm-message">{{ message }}</p>
      <div class="confirm-actions">
        <el-button v-if="mode === 'confirm'" @click="answer(false)">{{ cancelText }}</el-button>
        <el-button :type="danger ? 'danger' : 'primary'" @click="answer(true)">{{ confirmText }}</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ipcRenderer } from 'electron';
import { nextTick, onMounted, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { ConfirmDialogData } from '@common/types';

const title = ref('');
const message = ref('');
const confirmText = ref('确定');
const cancelText = ref('取消');
const mode = ref<'confirm' | 'alert'>('confirm');
const danger = ref(false);
const rootEl = ref<HTMLElement | null>(null);

/** 进窗口后自己去主进程取初始化数据 */
async function loadInitData(): Promise<void> {
  const data = (await ipcRenderer.invoke(IPC.CONFIRM_INIT)) as ConfirmDialogData | null;
  if (!data) {
    return;
  }
  title.value = data.title;
  message.value = data.message;
  confirmText.value = data.confirmText ?? '确定';
  cancelText.value = data.cancelText ?? '取消';
  mode.value = data.mode ?? 'confirm';
  danger.value = data.danger ?? false;
  void nextTick(() => rootEl.value?.focus());
}

/** 作答并关闭；主进程保证每次打开只回发一次结果 */
function answer(confirmed: boolean): void {
  void ipcRenderer.invoke(IPC.CONFIRM_SUBMIT, confirmed);
  window.close();
}

/** Esc 等同取消；提示模式下调用方本来就不关心结果 */
function onEscape(): void {
  answer(false);
}

onMounted(loadInitData);
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.confirm {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--app-bg-page);
  color: var(--app-text-regular);
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
  outline: none;
}

.confirm-header {
  height: 36px;
  line-height: 36px;
  padding: 0 var(--app-space-16);
  font-size: var(--app-font-lg);
  font-weight: 400;
  color: var(--app-text-primary);
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.confirm-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 0 var(--app-space-24) var(--app-space-20);
  -webkit-app-region: no-drag;
}

.confirm-message {
  font-size: var(--app-font-base);
  line-height: 1.7;
  color: var(--app-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--app-space-10);
}
</style>
