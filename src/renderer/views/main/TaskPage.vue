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
            <el-tag :type="typeTag(row.type)" size="small" class="type-tag">{{ typeLabel(row.type) }}</el-tag>
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
            <div class="progress-message">{{ row.status === 'failed' ? row.error : row.message }}</div>
          </template>
        </el-table-column>

        <el-table-column label="耗时" width="110" align="center">
          <template #default="{ row }">{{ formatDuration(row) }}</template>
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
import { ElMessageBox } from 'element-plus';
import type { TaskStatus, TaskType, TaskView } from '@common/types';
import { useTasks } from '@/composables/useTasks';

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

const TYPE_LABELS: Record<TaskType, string> = {
  scan: '扫描',
  process: '选图',
  export: '导出',
};

const TYPE_TAGS: Record<TaskType, 'primary' | 'success' | 'warning'> = {
  scan: 'primary',
  process: 'success',
  export: 'warning',
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

function typeTag(type: TaskType): 'primary' | 'success' | 'warning' {
  return TYPE_TAGS[type];
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

/** 强制结束不可回退，做一次二次确认 */
async function confirmForceStop(row: TaskView): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `任务「${row.title}」将立即结束，已处理的部分会保留。确定继续吗？`,
      '强制结束任务',
      { type: 'warning', confirmButtonText: '强制结束', cancelButtonText: '再想想' },
    );
  } catch {
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
  padding: 0 24px;
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
  color: #b4b6ba;
}

.summary b {
  color: #eceef1;
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
  color: #82858b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
