import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { TaskMoveDirection, TaskPayload, TaskSubmitResult, TaskType, TaskView } from '@common/types';

/** 调用主进程的任务命令；每个命令都返回最新的任务列表 */
function invoke(channel: string, ...args: unknown[]): Promise<TaskView[]> {
  return ipcRenderer.invoke(channel, ...args) as Promise<TaskView[]>;
}

/** 查询全部任务 */
export function listTasks(): Promise<TaskView[]> {
  return invoke(IPC.TASK_LIST);
}

/** 提交任务；额外返回新任务的 id */
export function submitTask(type: TaskType, payload: TaskPayload): Promise<TaskSubmitResult> {
  return ipcRenderer.invoke(IPC.TASK_SUBMIT, type, payload) as Promise<TaskSubmitResult>;
}

/** 取消尚未开始的任务 */
export function cancelTask(id: number): Promise<TaskView[]> {
  return invoke(IPC.TASK_CANCEL, id);
}

/** 暂停正在执行的任务 */
export function pauseTask(id: number): Promise<TaskView[]> {
  return invoke(IPC.TASK_PAUSE, id);
}

/** 继续被暂停的任务 */
export function resumeTask(id: number): Promise<TaskView[]> {
  return invoke(IPC.TASK_RESUME, id);
}

/** 强制结束正在执行或已暂停的任务 */
export function forceStopTask(id: number): Promise<TaskView[]> {
  return invoke(IPC.TASK_FORCE_STOP, id);
}

/** 调整待执行任务的顺序 */
export function moveTask(id: number, direction: TaskMoveDirection): Promise<TaskView[]> {
  return invoke(IPC.TASK_MOVE, id, direction);
}

/** 用同样的入参重新提交已结束的任务 */
export function retryTask(id: number): Promise<TaskView[]> {
  return invoke(IPC.TASK_RETRY, id);
}

/** 清空全部终态任务 */
export function clearFinishedTasks(): Promise<TaskView[]> {
  return invoke(IPC.TASK_CLEAR_FINISHED);
}
