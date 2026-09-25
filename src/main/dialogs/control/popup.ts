import { BrowserWindow, ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { PopupShowData } from '@common/types';

import { ensurePopup, get } from '@/window-manager';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 最近一次要展示的内容：宿主只挂载一次，冷启动时靠它补齐 */
let latest: PopupShowData | null = null;

// ------------------------------------------------------------
// 对外
// ------------------------------------------------------------

/** 注册浮窗宿主的通道 */
export function initPopup(): void {
  ipcMain.handle(IPC.POPUP_STATE, () => latest);
  ipcMain.handle(IPC.POPUP_HIDE, () => {
    get('popup')?.hide();
  });
}

/**
 * 在父窗口的指定位置展示一个浮窗。
 *
 * 窗口是复用的，这里只换内容与位置：已经挂载过就即时更新，第一次（还没挂载）那条推送会丢，
 * 由宿主挂载后 invoke `POPUP_STATE` 补齐。
 */
export function showPopup(
  parent: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
  data: PopupShowData,
): void {
  const window = ensurePopup();
  latest = data;

  window.setParentWindow(parent);
  window.setBounds(bounds);
  window.webContents.send(IPC.POPUP_SHOW, data);
  window.show();
  window.focus();
}

/** 收起浮窗（不销毁，下次复用） */
export function hidePopup(): void {
  get('popup')?.hide();
}

/**
 * 预先建好浮窗并隐藏。
 *
 * 点开时才创建的话，用户要等一个渲染进程起来（实测约 230ms）；预先建好之后每次展开只剩
 * 换内容、定位与 show()。这一个窗口服务全部浮窗种类，代价只有一份常驻内存。
 */
export function warmPopup(): void {
  ensurePopup();
}
