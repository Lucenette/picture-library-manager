import { ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { FileViewerInitData } from '@common/types';

import { createFileViewer, get } from '@/window-manager';

/** 注册图片组文件查看窗口 */
export function initFileViewer(): void {
  /** 待弹窗自己来取的初始数据 */
  const pending = new Map<number, FileViewerInitData>();

  ipcMain.handle(IPC.FILE_VIEWER_OPEN, (_event, data: FileViewerInitData) => {
    const window = createFileViewer();
    const rendererId = window.webContents.id;
    pending.set(rendererId, data);
    window.on('closed', () => pending.delete(rendererId));
  });

  // 初始数据由弹窗挂载后自己来取（invoke），主进程不在 did-finish-load 时推送：
  // 路由按需加载后组件挂载会晚于那个事件，推过去的消息会丢
  ipcMain.handle(IPC.FILE_VIEWER_INIT, (event) => pending.get(event.sender.id) ?? null);

  ipcMain.handle(IPC.FILE_VIEWER_SELECT, (_event, filePath: string) => {
    const mainWindow = get('main');
    if (mainWindow) {
      mainWindow.webContents.send(IPC.FILE_VIEWER_SELECTED, filePath);
    }
  });
}
