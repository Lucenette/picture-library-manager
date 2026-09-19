import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ConfirmDialogData, ConfirmDialogResult } from '@common/types';
import { createConfirm, get } from '@/window-manager';

/**
 * 注册原生确认 / 提示窗口。
 *
 * 与输入弹窗同一套协议：打开时带上结果要回发的通道，用户作答后由主进程转交
 * 给发起方。窗口被直接关掉也算一次「取消」——发起方一定会收到结果，
 * 不会因为用户点右上角关闭而永久等待。
 */
export function initConfirm(): void {
  /** 按弹窗渲染进程 id 记录它的作答回调 */
  const answers = new Map<number, (confirmed: boolean) => void>();

  ipcMain.handle(IPC.CONFIRM_OPEN, (_event, data: ConfirmDialogData) => {
    const window = createConfirm();
    const rendererId = window.webContents.id;

    let settled = false;
    const settle = (confirmed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      answers.delete(rendererId);

      const mainWindow = get('main');
      if (!mainWindow) {
        return;
      }
      mainWindow.webContents.send(data.channel, {
        channel: data.channel,
        confirmed,
        payload: data.payload,
      } satisfies ConfirmDialogResult);
    };

    answers.set(rendererId, settle);

    window.webContents.once('did-finish-load', () => {
      window.webContents.send(IPC.CONFIRM_INIT, data);
    });
    // 窗口被直接关掉时按「取消」处理
    window.on('closed', () => settle(false));
  });

  ipcMain.handle(IPC.CONFIRM_SUBMIT, (event, confirmed: boolean) => {
    const settle = answers.get(event.sender.id);
    if (settle) {
      settle(confirmed);
    }
  });
}
