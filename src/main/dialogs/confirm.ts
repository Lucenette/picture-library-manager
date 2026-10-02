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

  /** 待弹窗自己来取的初始数据 */
  const pending = new Map<number, ConfirmDialogData>();

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
    pending.set(rendererId, data);
    // 窗口被直接关掉时按「取消」处理
    window.on('closed', () => {
      settle(false);
      pending.delete(rendererId);
    });
  });

  // 初始数据由弹窗挂载后自己来取（invoke），主进程不在 did-finish-load 时推送：
  // 路由按需加载后组件挂载会晚于那个事件，推过去的消息会丢
  ipcMain.handle(IPC.CONFIRM_INIT, (event) => pending.get(event.sender.id) ?? null);

  ipcMain.handle(IPC.CONFIRM_SUBMIT, (event, confirmed: boolean) => {
    const settle = answers.get(event.sender.id);
    if (settle) {
      settle(confirmed);
    }
  });
}
