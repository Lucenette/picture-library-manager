import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import * as wm from '@/window-manager';

export const initBatchProcess = (): void => {
  ipcMain.handle(IPC.BATCH_PROCESS_OPEN, async (_event, data: any) => {
    const win = wm.createBatchProcess();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.BATCH_PROCESS_INIT, data);
    });
  });

  ipcMain.handle(IPC.BATCH_PROCESS_CONFIRM, (_event, scriptId: number) => {
    const mainWin = wm.get('main');
    if (mainWin) mainWin.webContents.send(IPC.BATCH_PROCESS_CONFIRMED, scriptId);
  });
};
