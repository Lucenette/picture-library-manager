<template>
  <div ref="rootEl" class="script-list" tabindex="0" @keydown.esc="close">
    <el-scrollbar>
      <div
        v-for="script in scripts"
        :key="script.id"
        class="script-item"
        :class="{ selected: script.id === selectedId }"
        @click="pick(script.id)"
      >
        {{ script.name }}
      </div>
      <div v-if="scripts.length === 0" class="script-empty">无可用脚本</div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ScriptListInitData } from '@common/types';

const scripts = ref<ScriptListInitData['scripts']>([]);
const selectedId = ref<number | null>(null);
const rootEl = ref<HTMLElement | null>(null);

function loadInitData(): void {
  ipcRenderer.once(IPC.DROPDOWN_INIT, (_event, data: ScriptListInitData) => {
    scripts.value = data.scripts;
    selectedId.value = data.selectedId;
    nextTick(() => rootEl.value?.focus());
  });
}

/** 选中后回传并关闭浮窗，结果由主进程转交给发起方 */
function pick(id: number): void {
  ipcRenderer.invoke(IPC.DROPDOWN_SELECT, id);
  window.close();
}

function close(): void {
  window.close();
}

onMounted(() => {
  loadInitData();
  // 浮窗失焦即视为取消选择
  window.addEventListener('blur', close);
});
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
