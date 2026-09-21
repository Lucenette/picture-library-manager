import { computed, ref } from 'vue';
import { IPC } from '@common/ipcChannels';
import type { TaskMoveDirection, TaskPayload, TaskProgressEvent, TaskType, TaskView } from '@common/types';
import { useIpcListener } from '@/composables/useIpcListener';
import {
  cancelTask, clearFinishedTasks, forceStopTask, listTasks, moveTask, pauseTask,
  resumeTask, retryTask, submitTask,
} from '@/services/task-service';

// 任务列表是全局单例状态：导航栏的徽标与任务页看的是同一份数据
const tasks = ref<TaskView[]>([]);
let subscribed = false;

/** 进度是高频事件，只就地打补丁，避免整表刷新 */
function applyProgress(event: TaskProgressEvent): void {
  const index = tasks.value.findIndex((item) => item.id === event.id);
  if (index < 0) {
    return;
  }
  tasks.value[index] = { ...tasks.value[index], progress: event.progress, message: event.message };
}

/** 订阅主进程推送并拉取一次初始列表，重复调用只会订阅一次 */
function ensureSubscribed(): void {
  if (subscribed) {
    return;
  }
  subscribed = true;

  // 推送就是整张排好序的列表，直接替换：既不会本地顺序漂移，
  // 也不用为每次状态变化再拉一次列表
  useIpcListener(IPC.TASK_CHANGED, (list: TaskView[]) => {
    tasks.value = list;
  });
  useIpcListener(IPC.TASK_PROGRESS, (event: TaskProgressEvent) => applyProgress(event));
  void refresh();
}

/** 重新拉取全部任务 */
async function refresh(): Promise<void> {
  tasks.value = await listTasks();
}

/** 执行一条任务命令并用返回的列表替换本地状态 */
async function run(command: () => Promise<TaskView[]>): Promise<void> {
  tasks.value = await command();
}

/**
 * 任务列表与操作入口。
 *
 * 命令统一返回最新列表，渲染进程直接整表替换；只有执行中的进度走推送，
 * 因此不需要在每次操作后自行拼接状态。
 */
export function useTasks() {
  ensureSubscribed();

  const runningCount = computed(
    () => tasks.value.filter((task) => task.status === 'running' || task.status === 'paused').length,
  );
  const pendingCount = computed(
    () => tasks.value.filter((task) => task.status === 'pending').length,
  );

  const actions = {
    // 提交要单独写：它除了替换整表，还要把新任务 id 交给调用方
    submit: async (type: TaskType, payload: TaskPayload): Promise<number> => {
      const result = await submitTask(type, payload);
      tasks.value = result.tasks;
      return result.id;
    },
    cancel: (id: number) => run(() => cancelTask(id)),
    pause: (id: number) => run(() => pauseTask(id)),
    resume: (id: number) => run(() => resumeTask(id)),
    forceStop: (id: number) => run(() => forceStopTask(id)),
    move: (id: number, direction: TaskMoveDirection) => run(() => moveTask(id, direction)),
    retry: (id: number) => run(() => retryTask(id)),
    clearFinished: () => run(clearFinishedTasks),
  };

  return { tasks, runningCount, pendingCount, refresh, actions };
}
