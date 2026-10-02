import { BrowserWindow, ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { ScanConfigInitData, ScanConfigResult } from '@common/types';

import { createScanConfig } from '@/window-manager';

/** 注册扫描配置窗口 */
export function initScanConfig(): void {
  /** 待弹窗自己来取的初始数据 */
  const pending = new Map<number, ScanConfigInitData>();

  ipcMain.handle(IPC.SCAN_CONFIG_OPEN, (_event, data: ScanConfigInitData) => {
    const window = createScanConfig();
    const rendererId = window.webContents.id;
    pending.set(rendererId, data);
    window.on('closed', () => pending.delete(rendererId));
  });

  // 初始数据由弹窗挂载后自己来取（invoke），主进程不在 did-finish-load 时推送：
  // 路由按需加载后组件挂载会晚于那个事件，推过去的消息会丢
  ipcMain.handle(IPC.SCAN_CONFIG_INIT, (event) => pending.get(event.sender.id) ?? null);

  ipcMain.handle(IPC.SCAN_CONFIG_CONFIRM, (event, result: ScanConfigResult) => {
    const parent = BrowserWindow.fromWebContents(event.sender)?.getParentWindow();
    parent?.webContents.send(IPC.SCAN_CONFIG_CONFIRMED, result);
  });
}
