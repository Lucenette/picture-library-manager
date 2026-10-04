<template>
  <div class="loading">
    <template v-if="visible">
      <div class="loading-header">{{ title }}</div>
      <div class="loading-body">
        <el-progress :percentage="percent" :status="barStatus" :stroke-width="8" />
        <p class="loading-title">{{ done }} / {{ total }} {{ step }}</p>
        <template v-if="failed">
          <p class="loading-error">{{ error }}</p>
          <p v-if="note" class="loading-note">{{ note }}</p>
          <p class="loading-hint">排除问题后重新启动应用，会接着这次继续。</p>
          <div class="loading-actions">
            <el-button type="danger" @click="quit">退出</el-button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';

import { loadState, quitLoading } from '@/loading';

const router = useRouter();

/**
 * 状态由主进程的加载服务推过来，这里只负责画。
 *
 * 只有真在加载（或加载失败）时才把界面画出来：正常启动也会经过这一页，那时状态要么还没到、
 * 要么已是终态，什么都不画，否则每次启动都会闪一下加载页。
 */
const visible = computed(() => loadState.value !== null && loadState.value.status !== 'succeeded');
const failed = computed(() => loadState.value?.status === 'failed');
const title = computed(() => loadState.value?.title ?? '');
const step = computed(() => loadState.value?.step ?? '');
const done = computed(() => loadState.value?.done ?? 0);
const total = computed(() => loadState.value?.total ?? 0);
const percent = computed(() => loadState.value?.percent ?? 0);
const error = computed(() => loadState.value?.error ?? '');
const note = computed(() => loadState.value?.note ?? '');
const barStatus = computed(() => (failed.value ? 'exception' : ''));

/** 失败页的退出：交给主进程决定何时结束进程 */
function quit(): void {
  quitLoading();
}

// 终态一到就切回主界面：用 replace 顶掉加载页这一条历史，后退键回不到这里。
// immediate 是因为「加载比这一页挂载更快」时，那一次推送已经过去了。
watch(
  () => loadState.value?.status,
  (status) => {
    if (status === 'succeeded') {
      void router.replace('/');
    }
  },
  { immediate: true },
);
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.loading {
  height: 100%;
  overflow: hidden;
  background: var(--app-bg-page);
  color: var(--app-text-regular);
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

.loading-header {
  height: 60px;
  line-height: 60px;
  padding: 0 32px;
  font-size: 16px;
  color: var(--app-text-primary);
}

.loading-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 32px;
}

.loading-title {
  font-size: 13px;
  color: var(--app-text-secondary);
}

.loading-error {
  font-size: 13px;
  line-height: 1.7;
  color: var(--app-danger);
  white-space: pre-wrap;
  word-break: break-all;
}

.loading-note,
.loading-hint {
  font-size: 12px;
  color: var(--app-text-muted);
  word-break: break-all;
}

.loading-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
