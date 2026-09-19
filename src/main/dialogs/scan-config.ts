import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ScanConfigInitData, ScanConfigResult } from '@common/types';
import { createScanConfig } from '@/window-manager';

/** 注册扫描配置窗口 */
export function initScanConfig(): void {
  ipcMain.handle(IPC.SCAN_CONFIG_OPEN, (_event, data: ScanConfigInitData) => {
    const window = createScanConfig();
    window.webContents.once('did-finish-load', () => {
      window.webContents.send(IPC.SCAN_CONFIG_INIT, data);
    });
  });

  ipcMain.handle(IPC.SCAN_CONFIG_CONFIRM, (event, result: ScanConfigResult) => {
    const parent = BrowserWindow.fromWebContents(event.sender)?.getParentWindow();
    parent?.webContents.send(IPC.SCAN_CONFIG_CONFIRMED, result);
  });
}
