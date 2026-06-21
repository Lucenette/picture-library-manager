import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import * as wm from '@/window-manager';

export const initPrompt = (): void => {
  ipcMain.handle(IPC.PROMPT_OPEN, async (_event, data: any) => {
    const win = wm.createPrompt();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.PROMPT_INIT, data);
    });
  });

  ipcMain.handle(IPC.PROMPT_CONFIRM, (_event, data: { channel: string; value: string }) => {
    const mainWin = wm.get('main');
    if (mainWin) mainWin.webContents.send(data.channel, data);
  });
};
