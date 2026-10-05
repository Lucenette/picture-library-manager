<template>
  <div ref="rootEl" class="script-list" tabindex="0" @keydown.esc="hide">
    <div class="script-list-body">
      <div
        v-for="script in payload.scripts"
        :key="script.id"
        class="script-item"
        :class="{ selected: script.id === payload.selectedId }"
        @click="pick(script.id)"
      >
        {{ script.name }}
      </div>
      <div v-if="payload.scripts.length === 0" class="script-empty">无可用脚本</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ipcRenderer } from 'electron';
import { nextTick, ref, watch } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { ScriptListInitData } from '@common/types';

const props = defineProps<{ payload: ScriptListInitData }>();

const rootEl = ref<HTMLElement | null>(null);

/**
 * 浮窗是复用的：同一个组件实例会被反复赋上新的 payload，所以每次都把焦点拿回来，
 * 否则 Esc 收不到按键。
 */
watch(
  () => props.payload,
  () => nextTick(() => rootEl.value?.focus()),
  { immediate: true },
);

/** 选中后回传，结果由主进程转交给发起方；窗口不销毁，由主进程收起 */
function pick(id: number): void {
  void ipcRenderer.invoke(IPC.DROPDOWN_SELECT, id);
}

/** 收起（Esc）：窗口留着给下次复用 */
function hide(): void {
  void ipcRenderer.invoke(IPC.POPUP_HIDE);
}
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.script-list {
  height: 100vh;
  overflow: hidden;
  background: var(--app-bg-surface);
  outline: none;
}

/* 原生滚动：这个窗口刻意不引 Element Plus（见 entries/popup.ts），省下整个组件库的启动成本 */
.script-list-body {
  height: 100%;
  overflow-y: auto;
}

.script-item {
  padding: var(--app-space-8) 14px;
  cursor: pointer;
  font-size: var(--app-font-base);
  color: var(--app-text-regular);
  height: 34px;
  line-height: 18px;
  box-sizing: border-box;
}

.script-item:hover {
  background: var(--app-bg-active);
}

.script-item.selected {
  color: var(--app-primary);
}

.script-empty {
  padding: var(--app-space-12) 14px;
  color: var(--app-text-muted);
  font-size: var(--app-font-base);
}
</style>
