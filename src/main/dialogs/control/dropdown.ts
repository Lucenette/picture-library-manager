import { BrowserWindow, ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { ScriptListOpenData } from '@common/types';

import { hidePopup, resolvePopupBounds, showPopup } from '@/dialogs/control/popup';

/** 注册脚本下拉浮窗：内容交给浮窗宿主渲染，这里只负责算位置与转交结果 */
export function initDropdown(): void {
  ipcMain.handle(IPC.DROPDOWN_OPEN, (event, data: ScriptListOpenData) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) {
      return;
    }

    const position = resolvePopupBounds(parentWindow, data);
    showPopup(
      parentWindow,
      { x: position.x, y: position.y, width: data.controlRect.width, height: data.listHeight },
      { kind: 'script-list', payload: data },
    );
  });

  ipcMain.handle(IPC.DROPDOWN_SELECT, (event, id: number) => {
    const parent = BrowserWindow.fromWebContents(event.sender)?.getParentWindow();
    if (parent) {
      parent.webContents.send(IPC.DROPDOWN_SELECTED, id);
    }
    hidePopup();
  });

}
