<template>
  <div class="select-ctrl">
    <div ref="buttonEl" class="select-btn" @click.stop="open">
      <span v-if="selectedName">{{ selectedName }}</span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span class="arrow">▾</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ipcRenderer } from 'electron';
import { computed, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { ScriptListOpenData, ScriptOption } from '@common/types';

const props = defineProps<{
  items: ScriptOption[];
  modelValue: number | null;
  placeholder: string;
}>();

const emit = defineEmits<{ (event: 'update:modelValue', value: number | null): void }>();

const buttonEl = ref<HTMLElement | null>(null);

const selectedName = computed(
  () => props.items.find((item) => item.id === props.modelValue)?.name ?? '',
);

/**
 * 打开原生浮窗并把定位信息交给主进程。
 *
 * 浮窗可能被点击空白直接关掉，此时上一次的订阅不会被消费，所以每次打开
 * 都要先清掉同名通道上的旧订阅，避免它在下一次选择时重复触发。
 */
function open(): void {
  const rect = buttonEl.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  const data: ScriptListOpenData = {
    scripts: props.items.map((item) => ({ id: item.id, name: item.name })),
    selectedId: props.modelValue,
    controlRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    listHeight: Math.max(34, Math.min(300, props.items.length * 34)),
  };

  ipcRenderer.removeAllListeners(IPC.DROPDOWN_SELECTED);
  ipcRenderer.once(IPC.DROPDOWN_SELECTED, (_event, id: number) => emit('update:modelValue', id));
  void ipcRenderer.invoke(IPC.DROPDOWN_OPEN, data);
}
</script>

<style scoped>
.select-ctrl {
  position: relative;
}

.select-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-strong);
  cursor: pointer;
  font-size: 13px;
  transition: border-color 0.15s;
}

.select-btn:hover {
  border-color: var(--app-border-hover);
}

.placeholder {
  color: var(--app-text-muted);
}

.arrow {
  color: var(--app-text-muted);
  font-size: 12px;
}
</style>
