import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { FileViewerInitData } from '@common/types';
import { createFileViewer, get } from '@/window-manager';

/** 注册图片组文件查看窗口 */
export function initFileViewer(): void {
  ipcMain.handle(IPC.FILE_VIEWER_OPEN, (_event, data: FileViewerInitData) => {
    const window = createFileViewer();
    window.webContents.once('did-finish-load', () => {
      window.webContents.send(IPC.FILE_VIEWER_INIT, data);
    });
  });

  ipcMain.handle(IPC.FILE_VIEWER_SELECT, (_event, filePath: string) => {
    const mainWindow = get('main');
    if (mainWindow) {
      mainWindow.webContents.send(IPC.FILE_VIEWER_SELECTED, filePath);
    }
  });
}
