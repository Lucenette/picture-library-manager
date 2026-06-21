<template>
  <div class="prompt">
    <div class="prompt-header">{{ title }}</div>
    <div class="prompt-body">
      <el-input v-model="value" :placeholder="placeholder" @keyup.enter="confirm" ref="inputEl" />
      <el-button type="primary" @click="confirm" :disabled="!value.trim()" style="width:100%;margin-top:20px">确定</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { IPC } from '@common/ipcChannels';
const { ipcRenderer } = require('electron');

const title = ref('');
const placeholder = ref('');
const value = ref('');
const inputEl = ref<any>(null);
let initData: any = {};

onMounted(() => {
  ipcRenderer.once(IPC.PROMPT_INIT, (_e: any, data: any) => {
    title.value = data.title;
    placeholder.value = data.placeholder || '';
    value.value = data.value || '';
    initData = data;
    nextTick(() => inputEl.value?.focus());
  });
});

function confirm(): void {
  const v = value.value.trim();
  if (!v) return;
  ipcRenderer.invoke(IPC.PROMPT_CONFIRM, { ...initData, value: v });
  window.close();
}

</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.prompt { height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: #1e1f22; color: #d8dadd; font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif; }
.prompt-header { height: 36px; line-height: 36px; padding: 0 16px; font-size: 16px; font-weight: 400; color: #eceef1; -webkit-app-region: drag; flex-shrink: 0; }
.prompt-body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 32px 24px; -webkit-app-region: no-drag; }
</style>
