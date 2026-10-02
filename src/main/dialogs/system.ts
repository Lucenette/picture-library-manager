import { dialog, ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';

/** 注册系统原生对话框 */
export function initSystem(): void {
  ipcMain.handle(IPC.DIALOG_OPEN_DIR, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择来源目录（可多选）',
      properties: ['openDirectory', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_OPEN_SCRIPT, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择脚本文件（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JavaScript', extensions: ['js'] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(IPC.DIALOG_EXPORT_DIR, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择导出目标目录',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
