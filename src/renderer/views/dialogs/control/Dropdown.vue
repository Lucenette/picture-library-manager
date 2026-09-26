<template>
  <div ref="rootEl" class="script-list" tabindex="0" @keydown.esc="hide">
    <el-scrollbar>
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
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ipcRenderer } from 'electron';
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
  ipcRenderer.invoke(IPC.DROPDOWN_SELECT, id);
}

/** 收起（Esc）：窗口留着给下次复用 */
function hide(): void {
  ipcRenderer.invoke(IPC.POPUP_HIDE);
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
  background: #2b2d30;
  outline: none;
}

.script-item {
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: #d8dadd;
  height: 34px;
  line-height: 18px;
  box-sizing: border-box;
}

.script-item:hover {
  background: #323438;
}

.script-item.selected {
  color: #3871e1;
}

.script-empty {
  padding: 12px 14px;
  color: #82858b;
  font-size: 13px;
}
</style>
