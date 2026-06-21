<template>
  <div class="select-ctrl">
    <div class="select-btn" @click.stop="open">
      <span v-if="selectedName">{{ selectedName }}</span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span class="arrow">▾</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, toRaw } from 'vue';
import { IPC } from '@common/ipcChannels';
import type { ScriptListOpenData } from '@common/types';
const { ipcRenderer } = require('electron');

const props = defineProps<{
  items: Array<{ id: number; name: string }>;
  modelValue: number | null;
  placeholder: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', v: number | null): void }>();

const selectedName = ref('');

watch(() => props.modelValue, (v) => {
  const item = props.items.find(i => i.id === v);
  selectedName.value = item?.name || '';
}, { immediate: true });

function open(): void {
  const el = document.querySelector('.select-btn') as HTMLElement;
  const rect = el.getBoundingClientRect();
  const data: ScriptListOpenData = {
    scripts: toRaw(props.items).map((i: any) => ({ id: i.id, name: i.name })),
    selectedId: props.modelValue,
    controlRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    listHeight: Math.max(34, Math.min(300, props.items.length * 34)),
  };
  ipcRenderer.once(IPC.DROPDOWN_SELECTED, (_e: any, id: number) => {
    emit('update:modelValue', id);
  });
  ipcRenderer.invoke(IPC.DROPDOWN_OPEN, data);
}
</script>

<style scoped>
.select-ctrl { position: relative; }
.select-btn {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-radius: 6px;
  background: #2b2d30; border: 1px solid #3e4044; cursor: pointer;
  font-size: 13px; transition: border-color 0.15s;
}
.select-btn:hover { border-color: #4a4c50; }
.placeholder { color: #82858b; }
.arrow { color: #82858b; font-size: 12px; }
</style>
