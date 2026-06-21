import { ipcMain, dialog } from 'electron';
import { IPC } from '@common/ipcChannels';

export const initSystem = (): void => {
  ipcMain.handle(IPC.DIALOG_OPEN_DIR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      title: '选择图库目录（可多选）',
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_OPEN_SCRIPT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JavaScript', extensions: ['js'] }],
      title: '选择脚本文件（可多选）',
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_EXPORT_DIR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择导出目标目录',
    });
    return result.canceled ? null : result.filePaths[0];
  });
};
