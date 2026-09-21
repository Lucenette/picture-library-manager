<template>
  <div class="similar">
    <div class="similar-bar">
      <span class="similar-title">相似图片</span>
      <span class="similar-summary">{{ summary }}</span>
    </div>

    <el-tabs v-model="activeTab" class="similar-tabs">
      <el-tab-pane :label="`相同图片 ${data.same.length} 组`" name="same" />
      <el-tab-pane :label="`相似图片 ${data.similar.length} 组`" name="similar" />
    </el-tabs>

    <div class="similar-body">
      <el-empty v-if="visibleGroups.length === 0" :description="emptyText" />
      <div v-for="(group, index) in visibleGroups" :key="index" class="similar-group">
        <div class="similar-group-head">第 {{ index + 1 }} 组 · {{ group.members.length }} 张</div>
        <div class="similar-group-body">
          <div v-for="member in group.members" :key="member.filePath" class="similar-item">
            <img v-if="member.thumbnail" class="similar-thumb" :src="member.thumbnail" alt="" />
            <div v-else class="similar-thumb similar-thumb-empty">无预览</div>
            <div class="similar-name" :title="member.filePath">{{ member.fileName }}</div>
            <div class="similar-meta">
              {{ member.width ?? 0 }} × {{ member.height ?? 0 }} · 差异 {{ member.distance }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { SimilarData, SimilarGroup } from '@common/types';

const activeTab = ref('same');
const data = ref<SimilarData>({ same: [], similar: [], compared: 0, skipped: 0 });

/** 当前页签要显示的组 */
const visibleGroups = computed<SimilarGroup[]>(() => (
  activeTab.value === 'same' ? data.value.same : data.value.similar
));

const summary = computed(() => {
  const parts = [`比对 ${data.value.compared} 张`];
  if (data.value.skipped > 0) {
    parts.push(`跳过 ${data.value.skipped} 张（没有感知哈希，重扫一次即可）`);
  }
  return parts.join(' · ');
});

const emptyText = computed(() => {
  // 一张哈希都没有时，别让人对着空窗口猜：直接说清要先重扫图库
  if (data.value.compared === 0 && data.value.skipped > 0) {
    return `这 ${data.value.skipped} 张都还没有感知哈希，重新扫描对应图库后再识别`;
  }
  return activeTab.value === 'same' ? '没有发现相同的图片' : '没有发现相似的图片';
});

onMounted(async () => {
  const result = (await ipcRenderer.invoke(IPC.SIMILAR_DATA)) as SimilarData | null;
  if (result) {
    data.value = result;
  }
});
</script>

<style scoped>
.similar {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1e1f22;
  color: #d8dadd;
}

.similar-bar {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.similar-title {
  font-size: 13px;
}

.similar-summary {
  font-size: 12px;
  color: #8b8f95;
}

.similar-tabs {
  padding: 0 12px;
  flex-shrink: 0;
}

.similar-body {
  flex: 1;
  overflow: auto;
  padding: 0 12px 12px;
}

.similar-group {
  margin-bottom: 16px;
  border: 1px solid #2b2d30;
  border-radius: 4px;
}

.similar-group-head {
  padding: 6px 10px;
  font-size: 12px;
  color: #8b8f95;
  border-bottom: 1px solid #2b2d30;
}

.similar-group-body {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px;
}

.similar-item {
  width: 108px;
}

.similar-thumb {
  width: 100px;
  height: 100px;
  object-fit: cover;
  border-radius: 4px;
  background: #2b2d30;
  display: block;
}

.similar-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #6f7378;
}

.similar-name {
  margin-top: 4px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.similar-meta {
  font-size: 11px;
  color: #8b8f95;
}
</style>
