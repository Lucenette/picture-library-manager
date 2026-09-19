import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { PromptInitData, PromptResult } from '@common/types';
import { createPrompt, get } from '@/window-manager';

/** 注册通用输入窗口 */
export function initPrompt(): void {
  ipcMain.handle(IPC.PROMPT_OPEN, (_event, data: PromptInitData) => {
    const window = createPrompt();
    window.webContents.once('did-finish-load', () => {
      window.webContents.send(IPC.PROMPT_INIT, data);
    });
  });

  // 输入窗口本身不知道结果该交给谁，由发起方在 channel 中指定
  ipcMain.handle(IPC.PROMPT_CONFIRM, (_event, result: PromptResult) => {
    const mainWindow = get('main');
    if (mainWindow) {
      mainWindow.webContents.send(result.channel, result);
    }
  });
}
