import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import * as wm from '@/window-manager';

export const initFileViewer = (): void => {
  ipcMain.handle(IPC.FILE_VIEWER_OPEN, async (_event, data: any) => {
    const win = wm.createFileViewer();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.FILE_VIEWER_INIT, data);
    });
  });

  ipcMain.handle(IPC.FILE_VIEWER_SELECT, (_event, filePath: string) => {
    const mainWin = wm.get('main');
    if (mainWin) mainWin.webContents.send(IPC.FILE_VIEWER_SELECTED, filePath);
  });
};
