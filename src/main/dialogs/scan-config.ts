import {BrowserWindow, ipcMain} from 'electron';
import { IPC } from '@common/ipcChannels';
import * as wm from '@/window-manager';

export const initScanConfig = (): void => {
  ipcMain.handle(IPC.SCAN_CONFIG_OPEN, async (_event, data: any) => {
    const win = wm.createScanConfig();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.SCAN_CONFIG_INIT, data);
    });
  });

  ipcMain.handle(IPC.SCAN_CONFIG_CONFIRM, (_event, payload: any) => {
    const parent = BrowserWindow.fromWebContents(_event.sender)?.getParentWindow();
    if (parent) {
      parent.webContents.send(IPC.SCAN_CONFIG_CONFIRMED, payload);
    }
  });
};
