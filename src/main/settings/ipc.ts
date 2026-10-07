import { BrowserWindow, ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { Settings, SettingsSnapshot } from '@common/settings';

import { getRootLevel } from '@/log';
import { getSettingsPath } from '@/paths';
import { applyWindowPalette } from '@/window-manager';

import { getSettings, onSettingsChanged, updateSettings } from './store';

// ============================================================
// 设置的 IPC
//
// 渲染进程只能拿快照、提交改动；文件只有主进程一个写者。
// ============================================================

/** 设置页要的只读运行信息：各项取值来自它自己的真源（级别来自 log、路径来自 paths） */
function snapshot(): SettingsSnapshot {
  const level = getRootLevel();
  return {
    settings: getSettings(),
    info: {
      filePath: getSettingsPath(),
      logLevel: level.level,
      logLevelSource: level.source,
    },
  };
}

/** 改动生效后广播给所有窗口：主题这类「立即生效」的项靠它落地，不需要重启 */
function broadcast(settings: Settings): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.SETTINGS_CHANGED, settings);
    }
  }
}

/**
 * 注册设置的 IPC。
 *
 * 与任务、脚本一样由启动流程在升级之后调用（见 `main/index.ts` 的 `initRest`）；设置本身早在
 * 建窗口之前就读进内存了（见 `store.ts` 的 `initSettings`），这里只是把读写口子挂上。
 */
export function initSettingsIpc(): void {
  ipcMain.handle(IPC.SETTINGS_GET, () => snapshot());
  ipcMain.handle(IPC.SETTINGS_SET, (_event, patch: unknown) => updateSettings(patch));
  // 一次改动两处副作用各挂一个订阅者：渲染进程那边重解析主题，主进程这边刷窗口底色与按钮字形色
  onSettingsChanged(broadcast);
  onSettingsChanged(() => applyWindowPalette());
}
