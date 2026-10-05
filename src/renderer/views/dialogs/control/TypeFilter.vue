<template>
  <div ref="rootEl" class="type-filter" tabindex="0" @keydown.esc="hide">
    <div
      v-for="option in payload.options"
      :key="option.value"
      class="filter-item"
      @click="toggle(option.value)"
    >
      <span class="filter-box" :class="{ checked: selected.includes(option.value) }" />
      <span class="filter-label">{{ option.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ipcRenderer } from 'electron';
import { nextTick, ref, watch } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { TypeFilterInitData } from '@common/types';

const props = defineProps<{ payload: TypeFilterInitData }>();

const rootEl = ref<HTMLElement | null>(null);
/** 勾选状态：初值取主进程给的那份，之后每动一次都回发给发起方，窗口不收起 */
const selected = ref<string[]>([]);

/**
 * 浮窗是复用的：同一个组件实例会被反复赋上新的 payload，所以每次都把勾选状态与焦点重置，
 * 否则拿到的还是上一次那份选择，Esc 也收不到按键。
 */
watch(
  () => props.payload,
  () => {
    selected.value = [...props.payload.selected];
    void nextTick(() => rootEl.value?.focus());
  },
  { immediate: true },
);

/**
 * 勾选一项：把当前选择整体回发（不关窗，点别处或按完成时才收）。
 *
 * 注意传的是数组副本：`selected.value` 是 Vue 的响应式代理，结构化克隆克隆不了 Proxy，
 * 直接传会以「could not be cloned」静默失败。
 */
function toggle(value: string): void {
  selected.value = selected.value.includes(value)
    ? selected.value.filter((item) => item !== value)
    : [...selected.value, value];
  void ipcRenderer.invoke(IPC.TYPE_FILTER_CHANGE, [...selected.value]);
}

/** 收起（Esc）：窗口留着给下次复用；勾选在点的时候就已经回发过了 */
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

.type-filter {
  height: 100vh;
  overflow-y: auto;
  background: var(--app-bg-surface);
  outline: none;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: var(--app-space-8);
  height: 32px;
  padding: 0 var(--app-space-12);
  cursor: pointer;
  font-size: var(--app-font-base);
  color: var(--app-text-regular);
}

.filter-item:hover {
  background: var(--app-bg-active);
}

/* 复选框：这个窗口刻意不引 Element Plus，所以按它的样子手画一个 */
.filter-box {
  position: relative;
  flex: none;
  width: 14px;
  height: 14px;
  border: 1px solid var(--app-border-hover);
  border-radius: var(--app-radius-2);
  background: var(--app-bg-page);
}

.filter-box.checked {
  background: var(--app-primary);
  border-color: var(--app-primary);
}

/* 勾：两个边框转 45°，与 Element Plus 的勾同一个画法 */
.filter-box.checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border-right: 1.5px solid var(--app-on-primary);
  border-bottom: 1.5px solid var(--app-on-primary);
  transform: rotate(45deg);
}

.filter-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>