import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import * as wm from '@/window-manager';

export const initImageViewer = (): void => {
  const viewerStore = new Map<number, any>();

  ipcMain.handle(IPC.VIEWER_OPEN, async (_event, data: any) => {
    const win = wm.createViewer();
    viewerStore.set(win.webContents.id, data);
  });

  ipcMain.handle(IPC.VIEWER_GET_DATA, (event) => {
    return viewerStore.get(event.sender.id);
  });
};
