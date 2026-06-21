<template>
  <div class="script-list" @keydown.escape="close" tabindex="0" ref="rootEl">
    <div v-for="s in scripts" :key="s.id" class="script-item" :class="{ selected: s.id === selectedId }" @click="pick(s.id)">
      {{ s.name }}
    </div>
    <div v-if="scripts.length === 0" class="script-empty">无可用脚本</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IPC } from '@common/ipcChannels';
import type { ScriptListInitData } from '@common/types';
const { ipcRenderer } = require('electron');

const scripts = ref<ScriptListInitData['scripts']>([]);
const selectedId = ref<number | null>(null);

onMounted(() => {
  ipcRenderer.once(IPC.SCRIPT_LIST_INIT, (_e: any, data: ScriptListInitData) => {
    scripts.value = data.scripts;
    selectedId.value = data.selectedId;
    (document.querySelector('.script-list') as HTMLElement)?.focus();
  });
  window.addEventListener('blur', () => window.close());
});

function pick(id: number): void {
  ipcRenderer.invoke(IPC.SCRIPT_LIST_SELECT, id);
  window.close();
}

function close(): void { window.close(); }
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.script-list {
  background: #2b2d30; overflow-y: auto;
  outline: none;
}
.script-item {
  padding: 8px 14px; cursor: pointer; font-size: 13px; color: #d8dadd;
}
.script-item:hover { background: #323438; }
.script-item.selected { color: #3871e1; }
.script-empty { padding: 12px 14px; color: #82858b; font-size: 13px; }
</style>
