<template>
  <div class="scan-config">
    <div class="config-header">扫描配置</div>
    <div class="config-body">
      <p class="gallery-name">图库：{{ galleryName }}</p>
      <p class="gallery-name" v-if="galleryCount > 1">共 {{ galleryCount }} 个图库</p>

      <DropdownControl v-model="scriptId" :items="scripts" placeholder="目录结构识别脚本" />

      <el-button type="primary" @click="confirm" :disabled="!scriptId" style="width:100%">开始扫描</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IPC } from '@common/ipcChannels';
import { ref, onMounted } from 'vue';
import DropdownControl from '../../components/DropdownControl.vue';
const { ipcRenderer } = require('electron');

const scriptId = ref<number | null>(null);
const scripts = ref<any[]>([]);
const galleryName = ref('');
const galleryCount = ref(1);
const galleryIds = ref<number[]>([]);

function init(): void {
  ipcRenderer.once(IPC.SCAN_CONFIG_INIT, (_e: any, data: any) => {
    scripts.value = data.scripts;
    galleryName.value = data.galleryName;
    galleryCount.value = data.galleryCount;
    galleryIds.value = data.galleryIds;
  });
}

async function confirm(): Promise<void> {
  if (!scriptId.value) return;
  await ipcRenderer.invoke(IPC.SCAN_CONFIG_CONFIRM, { galleryIds: [...galleryIds.value], scriptId: Number(scriptId.value) });
  window.close();
}

onMounted(init);
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.scan-config {
  height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  background: #1e1f22; color: #d8dadd;
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}
.config-header {
  height: 36px; line-height: 36px; padding: 0 16px;
  font-size: 16px; font-weight: 400; color: #eceef1;
  -webkit-app-region: drag;
  flex-shrink: 0;
}
.config-body {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: 0 32px 24px;
  -webkit-app-region: no-drag;
}
.gallery-name { margin-bottom: 16px; font-size: 13px; color: #b4b6ba; }
.config-body .el-button { margin-top: 20px; }
</style>
