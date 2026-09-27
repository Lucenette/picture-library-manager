import { BrowserWindow, ipcMain, type WebContents } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { TypeFilterOpenData } from '@common/types';

import { resolvePopupBounds, showPopup } from '@/dialogs/control/popup';

/** 最近一次打开类型过滤浮窗的那个渲染进程：勾选要一路回发给它 */
let opener: WebContents | null = null;

/**
 * 注册类型过滤浮窗。
 *
 * 与脚本下拉分开实现：那个是单选、选中即收起；这个是**多选且不收起**，勾一次回发一次。
 * 两者只共用浮窗窗口本身（`popup.ts`）与它的定位算法，通道与语义各走各的。
 */
export function initTypeFilter(): void {
  ipcMain.handle(IPC.TYPE_FILTER_OPEN, (event, data: TypeFilterOpenData) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) {
      return;
    }

    // 记下发起方：回发不依赖浮窗的父子窗口关系，主窗口直接开浮窗也一样稳
    opener = event.sender;
    const position = resolvePopupBounds(parentWindow, data);
    showPopup(
      parentWindow,
      { x: position.x, y: position.y, width: data.controlRect.width, height: data.listHeight },
      { kind: 'type-filter', payload: { options: data.options, selected: data.selected } },
    );
  });

  // 每勾一次回发一次当前选择；窗口不收起，由失焦或「完成」收起
  ipcMain.handle(IPC.TYPE_FILTER_CHANGE, (_event, selected: string[]) => {
    if (opener !== null && !opener.isDestroyed()) {
      opener.send(IPC.TYPE_FILTER_CHANGED, selected);
    }
  });
}