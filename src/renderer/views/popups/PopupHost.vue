<template>
  <Dropdown v-if="state?.kind === 'script-list'" :payload="state.payload" />
  <TypeFilter v-else-if="state?.kind === 'type-filter'" :payload="state.payload" />
</template>

<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { PopupShowData } from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';
import Dropdown from '@/views/dialogs/control/Dropdown.vue';
import TypeFilter from '@/views/dialogs/control/TypeFilter.vue';

/**
 * 仿原生浮窗的宿主。
 *
 * 所有浮窗共用这一个窗口与这一条路由：同一时刻只可能有一个浮窗可见，桌面应用里没必要为每种
 * 浮窗各占一个渲染进程。新增一种浮窗 = 并进 PopupShowData 联合类型，再在下面加一个 v-if 分支；
 * 窗口、路由与 IPC 通道都不用动。
 *
 * 分 kind 显式写分支而不是查一张组件表：模板里只有这样才保得住「哪一支 payload 配哪个组件」，
 * 查表会把 payload 变回联合类型，两边对不上。
 *
 * 具体内容由各浮窗自己的组件渲染，它们只接收 payload、不负责自己的显示与隐藏。
 */
const state = shallowRef<PopupShowData | null>(null);

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