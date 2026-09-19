import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { BatchProcessInitData } from '@common/types';
import { createBatchProcess, get } from '@/window-manager';

/** 注册批量处理窗口 */
export function initBatchProcess(): void {
  ipcMain.handle(IPC.BATCH_PROCESS_OPEN, (_event, data: BatchProcessInitData) => {
    const window = createBatchProcess();
    window.webContents.once('did-finish-load', () => {
      window.webContents.send(IPC.BATCH_PROCESS_INIT, data);
    });
  });

  ipcMain.handle(IPC.BATCH_PROCESS_CONFIRM, (_event, scriptId: number) => {
    const mainWindow = get('main');
    if (mainWindow) {
      mainWindow.webContents.send(IPC.BATCH_PROCESS_CONFIRMED, scriptId);
    }
  });
}
