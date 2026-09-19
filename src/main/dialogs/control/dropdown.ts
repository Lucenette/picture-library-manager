import { BrowserWindow, ipcMain, screen } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ScriptListOpenData } from '@common/types';
import { createDropdown } from '@/window-manager';

/** 浮窗与控件之间的间距 */
const LIST_MARGIN = 10;

/** 浮窗距屏幕边缘的安全距离 */
const SCREEN_SAFE_MARGIN = 20;

/** 注册脚本下拉浮窗 */
export function initDropdown(): void {
  ipcMain.handle(IPC.DROPDOWN_OPEN, (event, data: ScriptListOpenData) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parentWindow) {
      return;
    }

    const position = resolveListPosition(parentWindow, data);
    const listWindow = createDropdown(
      parentWindow,
      position.x,
      position.y,
      data.controlRect.width,
      data.listHeight,
    );
    listWindow.webContents.once('did-finish-load', () => {
      listWindow.webContents.send(IPC.DROPDOWN_INIT, data);
    });
  });

  ipcMain.handle(IPC.DROPDOWN_SELECT, (event, id: number) => {
    const parent = BrowserWindow.fromWebContents(event.sender)?.getParentWindow();
    if (parent) {
      parent.webContents.send(IPC.DROPDOWN_SELECTED, id);
    }
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
