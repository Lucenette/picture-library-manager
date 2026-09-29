import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ViewerOpenRequest } from '@common/types';
import { createViewer } from '@/window-manager';

/** 图片查看器待读取的数据，按渲染进程 id 暂存 */
const viewerPayloads = new Map<number, ViewerOpenRequest>();

/** 注册图片查看器窗口 */
export function initImageViewer(): void {
  ipcMain.handle(IPC.VIEWER_OPEN, (_event, payload: ViewerOpenRequest) => {
    const window = createViewer();
    const rendererId = window.webContents.id;
    viewerPayloads.set(rendererId, payload);
    window.on('closed', () => viewerPayloads.delete(rendererId));
  });

  ipcMain.handle(IPC.VIEWER_GET_DATA, (event) => viewerPayloads.get(event.sender.id));
}
