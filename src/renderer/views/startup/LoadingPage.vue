<template>
  <div class="loading">
    <template v-if="visible">
      <div class="loading-header">数据库升级</div>
      <div class="loading-body">
        <el-progress :percentage="percent" :status="barStatus" :stroke-width="8" />
        <p class="loading-title">{{ title }}</p>
        <template v-if="failed">
          <p class="loading-error">{{ error }}</p>
          <p v-if="backupPath" class="loading-backup">升级前的备份：{{ backupPath }}</p>
          <p class="loading-hint">排除问题后重新启动应用，会从这一条接着来。</p>
          <div class="loading-actions">
            <el-button type="danger" @click="quit">退出</el-button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { MigrationProgress } from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';

const router = useRouter();
const state = ref<MigrationProgress | null>(null);

/**
 * 只有真在升级（或升级失败）时才把界面画出来。
 *
 * 正常启动也要经过这一页，但那时状态要么还没到、要么已是终态，什么都不画，
 * 否则每次启动都会闪一下加载页。
 */
const visible = computed(() => state.value !== null && state.value.status !== 'succeeded');
const failed = computed(() => state.value?.status === 'failed');
const percent = computed(() => state.value?.percent ?? 0);
const error = computed(() => state.value?.error ?? '');
const backupPath = computed(() => state.value?.backupPath ?? '');
const barStatus = computed(() => (failed.value ? 'exception' : ''));

const title = computed(() => {
  const current = state.value;
  if (!current) {
    return '';
  }
  return `${current.done} / ${current.total}　${current.currentTitle}`;
});

/** 升级完成就切到主界面；用 replace 顶掉加载页这一条历史，后退键回不到这里 */
function apply(next: MigrationProgress): void {
  state.value = next;
  if (next.status === 'succeeded') {
    void router.replace('/');
  }
}

/** 失败页的退出：交给主进程决定何时结束进程 */
function quit(): void {
  void ipcRenderer.invoke(IPC.CHANGESET_QUIT);
}

// 先订阅再取快照：升级比页面加载更快时，快照里已经是终态
useIpcListener(IPC.CHANGESET_PROGRESS, (next: MigrationProgress) => apply(next));

onMounted(async () => {
  const snapshot = (await ipcRenderer.invoke(IPC.CHANGESET_STATE)) as MigrationProgress | null;
  if (snapshot) {
    apply(snapshot);
  }
});
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
  background: #1e1f22;
  color: #d8dadd;
  font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
}

.loading-header {
  height: 60px;
  line-height: 60px;
  padding: 0 32px;
  font-size: 16px;
  color: #eceef1;
}

.loading-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0 32px;
}

.loading-title {
  font-size: 13px;
  color: #b4b6ba;
}

.loading-error {
  font-size: 13px;
  line-height: 1.7;
  color: #f56c6c;
  white-space: pre-wrap;
  word-break: break-all;
}

.loading-backup,
.loading-hint {
  font-size: 12px;
  color: #8b8e94;
  word-break: break-all;
}

.loading-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
