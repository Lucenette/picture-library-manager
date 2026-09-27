import { ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { MigrationProgress } from '@common/types';

import { get } from '@/window-manager';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 最近一次进度：加载页比第一批进度加载得更晚时靠它补齐 */
let latest: MigrationProgress | null = null;

/** 失败页点「退出」后要唤醒的那个等待 */
let settle: (() => void) | null = null;

// ------------------------------------------------------------
// 对外
// ------------------------------------------------------------

/** 注册升级页的两条通道；由 initUps() 调用，不单独出现在启动流程里 */
export function initUpsIpc(): void {
  ipcMain.handle(IPC.UPS_STATE, () => latest);
  ipcMain.handle(IPC.UPS_QUIT, () => {
    const current = settle;
    settle = null;
    current?.();
  });
}

/** 推送进度并记下快照，供后加载的加载页补齐 */
export function sendUpsProgress(progress: MigrationProgress): void {
  latest = progress;
  const mainWindow = get('main');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UPS_PROGRESS, progress);
  }
}

/** 等待用户在失败页点「退出」 */
export function waitUpsQuit(): Promise<void> {
  return new Promise((resolve) => {
    settle = resolve;
  });
}
