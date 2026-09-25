import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { BatchProcessInitData } from '@common/types';
import { createBatchProcess, get } from '@/window-manager';

/** 注册批量处理窗口 */
export function initBatchProcess(): void {
  /** 待弹窗自己来取的初始数据 */
  const pending = new Map<number, BatchProcessInitData>();

  ipcMain.handle(IPC.BATCH_PROCESS_OPEN, (_event, data: BatchProcessInitData) => {
    const window = createBatchProcess();
    const rendererId = window.webContents.id;
    pending.set(rendererId, data);
    window.on('closed', () => pending.delete(rendererId));
  });

  // 初始数据由弹窗挂载后自己来取（invoke），主进程不在 did-finish-load 时推送：
  // 路由按需加载后组件挂载会晚于那个事件，推过去的消息会丢
  ipcMain.handle(IPC.BATCH_PROCESS_INIT, (event) => pending.get(event.sender.id) ?? null);

  ipcMain.handle(IPC.BATCH_PROCESS_CONFIRM, (_event, scriptId: number) => {
    const mainWindow = get('main');
    if (mainWindow) {
      mainWindow.webContents.send(IPC.BATCH_PROCESS_CONFIRMED, scriptId);
    }
  });
}
