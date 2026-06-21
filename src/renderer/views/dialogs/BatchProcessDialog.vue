<template>
  <div class="batch-config">
    <div class="config-header">批量处理</div>
    <div class="config-body">
      <p class="info">已选择 {{ count }} 个图片组</p>
      <DropdownControl v-model="scriptId" :items="scripts" placeholder="选择处理脚本" />
      <el-button type="primary" @click="confirm" :disabled="!scriptId" style="width:100%;margin-top:20px">开始处理</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { IPC } from '@common/ipcChannels';
import DropdownControl from '@/components/DropdownControl.vue';
const { ipcRenderer } = require('electron');

const scriptId = ref<number | null>(null);
const scripts = ref<any[]>([]);
const count = ref(0);

onMounted(() => {
  ipcRenderer.once(IPC.BATCH_PROCESS_INIT, (_e: any, data: any) => {
    scripts.value = data.scripts;
    count.value = data.count;
  });
});

async function confirm(): Promise<void> {
  if (!scriptId.value) return;
  await ipcRenderer.invoke(IPC.BATCH_PROCESS_CONFIRM, Number(scriptId.value));
  window.close();
}
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.batch-config {
  height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  background: #1e1f22; color: #d8dadd;
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}
.config-header {
  height: 36px; line-height: 36px; padding: 0 16px;
  font-size: 16px; font-weight: 400; color: #eceef1;
  -webkit-app-region: drag; flex-shrink: 0;
}
.config-body {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: 0 32px 24px;
  -webkit-app-region: no-drag;
}
.info { margin-bottom: 16px; font-size: 13px; color: #b4b6ba; }
</style>
