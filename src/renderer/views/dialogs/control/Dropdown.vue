<template>
  <div class="script-list" @keydown.esc="close" tabindex="0" ref="rootEl">
    <el-scrollbar>
      <div v-for="s in scripts" :key="s.id" class="script-item" :class="{ selected: s.id === selectedId }" @click="pick(s.id)">
        {{ s.name }}
      </div>
      <div v-if="scripts.length === 0" class="script-empty">无可用脚本</div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IPC } from '@common/ipcChannels';
import type { ScriptListInitData } from '@common/types';
import { ipcRenderer } from 'electron';

const scripts = ref<ScriptListInitData['scripts']>([]);
const selectedId = ref<number | null>(null);

onMounted(() => {
  ipcRenderer.once(IPC.DROPDOWN_INIT, (_e: any, data: ScriptListInitData) => {
    scripts.value = data.scripts;
    selectedId.value = data.selectedId;
    (document.querySelector('.script-list') as HTMLElement)?.focus();
  });
  window.addEventListener('blur', () => window.close());
});

function pick(id: number): void {
  ipcRenderer.invoke(IPC.DROPDOWN_SELECT, id);
  window.close();
}

function close(): void { window.close(); }
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.script-list {
  height: 100vh; overflow: hidden;
  background: #2b2d30; outline: none;
}
.script-item {
  padding: 8px 14px; cursor: pointer; font-size: 13px; color: #d8dadd;
  height: 34px; line-height: 18px; box-sizing: border-box;
}
.script-item:hover { background: #323438; }
.script-item.selected { color: #3871e1; }
.script-empty { padding: 12px 14px; color: #82858b; font-size: 13px; }
</style>
