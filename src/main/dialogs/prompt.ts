import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { PromptInitData, PromptResult } from '@common/types';
import { createPrompt, get } from '@/window-manager';

/** 注册通用输入窗口 */
export function initPrompt(): void {
  /** 待弹窗自己来取的初始数据 */
  const pending = new Map<number, PromptInitData>();

  ipcMain.handle(IPC.PROMPT_OPEN, (_event, data: PromptInitData) => {
    const window = createPrompt();
    const rendererId = window.webContents.id;
    pending.set(rendererId, data);
    window.on('closed', () => pending.delete(rendererId));
  });

  // 初始数据由弹窗挂载后自己来取（invoke），主进程不在 did-finish-load 时推送：
  // 路由按需加载后组件挂载会晚于那个事件，推过去的消息会丢
  ipcMain.handle(IPC.PROMPT_INIT, (event) => pending.get(event.sender.id) ?? null);

  // 输入窗口本身不知道结果该交给谁，由发起方在 channel 中指定
  ipcMain.handle(IPC.PROMPT_CONFIRM, (_event, result: PromptResult) => {
    const mainWindow = get('main');
    if (mainWindow) {
      mainWindow.webContents.send(result.channel, result);
    }
  });
}
