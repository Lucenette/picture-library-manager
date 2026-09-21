import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { TaskMoveDirection, TaskPayload, TaskSubmitResult, TaskType } from '@common/types';
import { taskManager } from '@/task/manager';

/**
 * 注册后台任务通道。
 *
 * 命令一律通过 invoke 下发并返回最新任务列表，渲染进程直接整表替换；
 * 执行期间的变化由主进程主动推送：状态变化推整张列表（TASK_CHANGED），
 * 高频进度只带 { id, progress, message } 就地打补丁（TASK_PROGRESS）。
 * 例外是提交：它额外返回新任务的 id，调用方不必去列表里猜。
 */
export function initTaskIpc(): void {
  ipcMain.handle(IPC.TASK_LIST, () => taskManager.list());

  // 提交是唯一需要额外返回值的命令：调用方必须知道新建的是哪一条，
  // 否则只能去列表里"猜"那条是自己的
  ipcMain.handle(IPC.TASK_SUBMIT, (_event, type: TaskType, payload: TaskPayload) => {
    const id = taskManager.submit(type, payload);
    return { id, tasks: taskManager.list() } satisfies TaskSubmitResult;
  });

  ipcMain.handle(IPC.TASK_CANCEL, (_event, id: number) => {
    taskManager.cancel(id);
    return taskManager.list();
  });

  ipcMain.handle(IPC.TASK_PAUSE, (_event, id: number) => {
    taskManager.pause(id);
    return taskManager.list();
  });

  ipcMain.handle(IPC.TASK_RESUME, (_event, id: number) => {
    taskManager.resume(id);
    return taskManager.list();
  });

  ipcMain.handle(IPC.TASK_FORCE_STOP, (_event, id: number) => {
    taskManager.forceStop(id);
    return taskManager.list();
  });

  ipcMain.handle(IPC.TASK_MOVE, (_event, id: number, direction: TaskMoveDirection) => {
    taskManager.move(id, direction);
    return taskManager.list();
  });

  ipcMain.handle(IPC.TASK_RETRY, (_event, id: number) => {
    taskManager.retry(id);
    return taskManager.list();
  });

  ipcMain.handle(IPC.TASK_CLEAR_FINISHED, () => {
    taskManager.clearFinished();
    return taskManager.list();
  });
}
