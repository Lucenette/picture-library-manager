<template>
  <div class="task-page">
    <div class="toolbar">
      <div class="summary">
        <span class="summary-item">进行中 <b>{{ runningCount }}</b></span>
        <span class="summary-item">排队中 <b>{{ pendingCount }}</b></span>
        <span class="summary-item">失败 <b>{{ failedCount }}</b></span>
      </div>
      <el-button :disabled="finishedCount === 0" @click="clearFinished">清除已完成</el-button>
    </div>

    <div class="table-wrap">
      <el-table :data="pagedTasks" row-key="id">
        <el-table-column label="任务" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag :class="`type-tag--${row.type}`" :type="typeTag(row.type)" size="small" class="type-tag">{{ typeLabel(row.type) }}</el-tag>
            <span>{{ row.title }}</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="进度" min-width="260">
          <template #default="{ row }">
            <el-progress
              :percentage="row.progress"
              :status="row.status === 'failed' ? 'exception' : row.status === 'done' ? 'success' : ''"
            />
            <div
              class="progress-message"
              :class="{ 'progress-message--warn': hasFailure(row) }"
              :title="statusMessage(row)"
            >
              {{ statusMessage(row) }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="耗时" width="110" align="center">
          <template #default="{ row }">{{ formatDuration(row) }}</template>
        </el-table-column>

        <el-table-column label="创建时间" width="170" align="center">
          <template #default="{ row }">{{ row.createdAt || '—' }}</template>
        </el-table-column>

        <el-table-column label="开始时间" width="170" align="center">
          <template #default="{ row }">{{ row.startedAt || '—' }}</template>
        </el-table-column>

        <el-table-column label="结束时间" width="170" align="center">
          <template #default="{ row }">{{ row.finishedAt || '—' }}</template>
        </el-table-column>

        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button size="small" text @click="actions.move(row.id, 'up')">上移</el-button>
              <el-button size="small" text @click="actions.move(row.id, 'down')">下移</el-button>
              <el-button size="small" text type="danger" @click="actions.cancel(row.id)">取消</el-button>
            </template>

            <template v-else-if="row.status === 'running'">
              <el-button size="small" text @click="actions.pause(row.id)">暂停</el-button>
              <el-button size="small" text type="danger" @click="confirmForceStop(row)">强制结束</el-button>
            </template>

            <template v-else-if="row.status === 'paused'">
              <el-button size="small" text type="primary" @click="actions.resume(row.id)">继续</el-button>
              <el-button size="small" text type="danger" @click="confirmForceStop(row)">强制结束</el-button>
            </template>

            <template v-else>
              <el-button size="small" text type="primary" @click="actions.retry(row.id)">重试</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]"
      :total="tasks.length"
      layout="total, sizes, prev, pager, next, jumper"
      class="pager"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import type {
  ExportTaskResult, SimilarTaskResult, ProcessTaskResult, ScanTaskResult, TaskStatus, TaskType, TaskView,
} from '@common/types';

import { useTasks } from '@/composables/useTasks';
import { confirmDialog } from '@/services/dialog-service';

/** 运行中任务的耗时每秒刷新一次 */
const REFRESH_INTERVAL_MS = 1000;

const { tasks, runningCount, pendingCount, actions } = useTasks();

/** 用于计算进行中任务的实时耗时 */
const nowTick = ref(Date.now());
let timer: number | undefined;

const page = ref(1);
const pageSize = ref(20);
const pagedTasks = computed(() =>
  tasks.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

// ------------------------------------------------------------
// 统计
// ------------------------------------------------------------

const failedCount = computed(() => tasks.value.filter((task) => task.status === 'failed').length);
const finishedCount = computed(
  () => tasks.value.filter((task) => task.status === 'done' || task.status === 'failed' || task.status === 'cancelled').length,
);

// ------------------------------------------------------------
// 展示
// ------------------------------------------------------------

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '排队中',
  running: '进行中',
  paused: '已暂停',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_TAGS: Record<TaskStatus, 'info' | 'primary' | 'warning' | 'success' | 'danger'> = {
  pending: 'info',
  running: 'primary',
  paused: 'warning',
  done: 'success',
  failed: 'danger',
  cancelled: 'info',
};

/** 任务类型标签的配色 */
type TaskTagType = 'primary' | 'success' | 'warning' | 'info';

const TYPE_LABELS: Record<TaskType, string> = {
  scan: '扫描',
  process: '选图',
  export: '导出',
  similar: '识图',
};

const TYPE_TAGS: Record<TaskType, TaskTagType> = {
  scan: 'primary',
  process: 'success',
  export: 'warning',
  similar: 'info',
};

function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

function statusTag(status: TaskStatus): 'info' | 'primary' | 'warning' | 'success' | 'danger' {
  return STATUS_TAGS[status];
}

function typeLabel(type: TaskType): string {
  return TYPE_LABELS[type];
}

function typeTag(type: TaskType): TaskTagType {
  return TYPE_TAGS[type];
}

/** 终态优先展示结果摘要或错误原因，执行中展示阶段描述 */
function statusMessage(row: TaskView): string {
  if (row.status === 'failed') {
    return row.error;
  }
  if (row.status === 'done') {
    return resultSummary(row) || row.message;
  }
  return row.message;
}

/** 把任务结果拼成一行摘要；失败张数一并显示，避免"看起来成功了其实有跳过" */
function resultSummary(row: TaskView): string {
  const result = row.result;
  if (!result) {
    return '';
  }

  if (row.type === 'scan') {
    const scan = result as ScanTaskResult;
    const failures = scan.thumbnailFailures > 0 ? ` · 缩略图失败 ${scan.thumbnailFailures}` : '';
    const engine = scan.thumbnailEngine === 'none' ? '' : ` · 解码 ${scan.thumbnailEngine === 'sharp' ? 'sharp' : '内置'}`;
    return `角色 ${scan.characters} · 图片组 ${scan.groups} · 文件 ${scan.files} · 缩略图 ${scan.thumbnails}${failures}${engine}`;
  }

  if (row.type === 'process') {
    const process = result as ProcessTaskResult;
    return `成功 ${process.processed} · 失败 ${process.failed}`;
  }

  if (row.type === 'similar') {
    const similar = result as SimilarTaskResult;
    const skipped = similar.skipped > 0 ? ` · 跳过 ${similar.skipped}（没有感知哈希）` : '';
    return `比对 ${similar.compared} 张 · 相同 ${similar.sameGroups} 组 · 相似 ${similar.similarGroups} 组${skipped}`;
  }

  const exported = result as ExportTaskResult;
  return `已复制 ${exported.copied} · 失败 ${exported.failed}`;
}

/** 结果里是否含失败项，用于把摘要标成警示色 */
function hasFailure(row: TaskView): boolean {
  const result = row.result;
  if (!result) {
    return false;
  }

  if (row.type === 'scan') {
    return (result as ScanTaskResult).thumbnailFailures > 0;
  }
  if (row.type === 'process') {
    return (result as ProcessTaskResult).failed > 0;
  }
  return (result as ExportTaskResult).failed > 0;
}

/** 主进程写入的是 'YYYY-MM-DD HH:mm:ss'，换成带 T 的形式再解析 */
function parseTime(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatDuration(row: TaskView): string {
  const startedAt = parseTime(row.startedAt);
  if (startedAt === null) {
    return '-';
  }

  const finishedAt = parseTime(row.finishedAt) ?? nowTick.value;
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

// ------------------------------------------------------------
// 操作
// ------------------------------------------------------------

async function clearFinished(): Promise<void> {
  await actions.clearFinished();
  page.value = 1;
}

/** 强制结束不可回退，走原生确认窗口做二次确认 */
async function confirmForceStop(row: TaskView): Promise<void> {
  const confirmed = await confirmDialog({
    title: '强制结束任务',
    message: `任务「${row.title}」将立即结束，已处理的部分会保留。`,
    confirmText: '强制结束',
    cancelText: '再想想',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await actions.forceStop(row.id);
}

onMounted(() => {
  timer = window.setInterval(() => {
    nowTick.value = Date.now();
  }, REFRESH_INTERVAL_MS);
});

onUnmounted(() => {
  if (timer !== undefined) {
    window.clearInterval(timer);
  }
});
</script>

<style scoped>
.task-page {
  padding: var(--page-padding);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.summary {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: var(--app-text-secondary);
}

.summary b {
  color: var(--app-text-primary);
}

.table-wrap {
  flex: 1;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  height: 100%;
}

.type-tag {
  margin-right: 8px;
}

.progress-message {
  margin-top: 2px;
  font-size: 12px;
  color: var(--app-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-message--warn {
  color: var(--app-warning);
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
