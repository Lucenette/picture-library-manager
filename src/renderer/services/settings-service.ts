import { ipcRenderer } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { Settings, SettingsSnapshot, SettingsUpdateResult } from '@common/settings';

/** 取设置快照与只读运行信息 */
export function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  return ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<SettingsSnapshot>;
}

/**
 * 提交改动。
 *
 * 只有主进程一个写者：它校验、落盘、更新内存后才回话，界面据此更新，不做乐观更新——
 * 否则会出现「界面换了、文件没换」。主题这一类的跨窗口生效由主进程广播，这里拿到的只是回执。
 */
export function updateSettings(patch: Partial<Settings>): Promise<SettingsUpdateResult> {
  return ipcRenderer.invoke(IPC.SETTINGS_SET, patch) as Promise<SettingsUpdateResult>;
}
