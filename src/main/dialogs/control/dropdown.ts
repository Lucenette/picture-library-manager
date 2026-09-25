import { BrowserWindow, ipcMain, screen } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { ScriptListOpenData } from '@common/types';

import { hidePopup, showPopup } from '@/dialogs/control/popup';

/** 浮窗与控件之间的间距 */
const LIST_MARGIN = 10;

/** 浮窗距屏幕边缘的安全距离 */
const SCREEN_SAFE_MARGIN = 20;

/** 注册脚本下拉浮窗：内容交给浮窗宿主渲染，这里只负责算位置与转交结果 */
export function initDropdown(): void {
  ipcMain.handle(IPC.DROPDOWN_OPEN, (event, data: ScriptListOpenData) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) {
      return;
    }

    const position = resolveListPosition(parentWindow, data);
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

/** 计算浮窗的屏幕坐标：默认贴在控件下方，下方空间不足时翻到控件上方 */
function resolveListPosition(
  parentWindow: BrowserWindow,
  data: ScriptListOpenData,
): { x: number; y: number } {
  const bounds = parentWindow.getBounds();
  const { controlRect, listHeight } = data;
  const x = bounds.x + controlRect.x;
  const belowY = bounds.y + controlRect.y + controlRect.height + LIST_MARGIN;
  const screenHeight = screen.getPrimaryDisplay().workAreaSize.height;
  const y = belowY + listHeight > screenHeight - SCREEN_SAFE_MARGIN
    ? bounds.y + controlRect.y - listHeight - LIST_MARGIN
    : belowY;
  return { x, y };
}
