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

/** 注册数据库升级用的通道；必须在主窗口加载之前调用 */
export function initChangesetIpc(): void {
  ipcMain.handle(IPC.CHANGESET_STATE, () => latest);
  ipcMain.handle(IPC.CHANGESET_QUIT, () => {
    const current = settle;
    settle = null;
    current?.();
  });
}

/** 推送进度并记下快照，供后加载的加载页补齐 */
export function sendChangesetProgress(progress: MigrationProgress): void {
  latest = progress;
  const mainWindow = get('main');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.CHANGESET_PROGRESS, progress);
  }
}

/** 等待用户在失败页点「退出」 */
export function waitForChangesetQuit(): Promise<void> {
  return new Promise((resolve) => {
    settle = resolve;
  });
}
