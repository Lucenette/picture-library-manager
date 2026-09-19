import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { TaskMoveDirection, TaskPayload, TaskType } from '@common/types';
import { taskManager } from '@/task/manager';

/**
 * 注册后台任务通道。
 *
 * 命令一律通过 invoke 下发并返回最新任务列表，渲染进程直接整表替换；
 * 执行期间的变化由主进程通过 TASK_CHANGED / TASK_PROGRESS 主动推送。
 */
export function initTaskIpc(): void {
  ipcMain.handle(IPC.TASK_LIST, () => taskManager.list());

  ipcMain.handle(IPC.TASK_SUBMIT, (_event, type: TaskType, payload: TaskPayload) => {
    taskManager.submit(type, payload);
    return taskManager.list();
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
