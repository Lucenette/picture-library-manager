<template>
  <component :is="view?.component" v-if="view" :payload="view.payload" />
</template>

<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { PopupShowData } from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';
import Dropdown from '@/views/dialogs/control/Dropdown.vue';

/**
 * 仿原生浮窗的宿主。
 *
 * 所有浮窗共用这一个窗口与这一条路由：同一时刻只可能有一个浮窗可见，桌面应用里没必要为每种
 * 浮窗各占一个渲染进程。新增一种浮窗 = 在 COMPONENTS 里登记组件、并把它并入 PopupShowData
 * 联合类型；窗口、路由与 IPC 通道都不用动。
 *
 * 具体内容由各浮窗自己的组件渲染，它们只接收 payload、不负责自己的显示与隐藏。
 */
const COMPONENTS = {
  'script-list': Dropdown,
} as const;

const state = shallowRef<PopupShowData | null>(null);

const view = computed(() => {
  const current = state.value;
  return current ? { component: COMPONENTS[current.kind], payload: current.payload } : null;
});

/** 主进程每次展开浮窗都会推来新的内容 */
function apply(data: PopupShowData): void {
  state.value = data;
}

useIpcListener(IPC.POPUP_SHOW, (data: PopupShowData) => apply(data));

onMounted(async () => {
  const snapshot = (await ipcRenderer.invoke(IPC.POPUP_STATE)) as PopupShowData | null;
  if (snapshot) {
    apply(snapshot);
  }
});
</script>
