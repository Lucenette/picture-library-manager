import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ConfirmDialogData, ConfirmDialogResult } from '@common/types';

/**
 * 打开原生确认 / 提示窗口并等待用户作答。
 *
 * 主进程保证每次打开只会回发一次结果（直接关窗按取消处理），
 * 因此这里的 once 订阅一定会被消费，不会残留。
 */
function openConfirmDialog(data: ConfirmDialogData): Promise<boolean> {
  return new Promise((resolve) => {
    ipcRenderer.once(IPC.CONFIRM_RESULT, (_event, result: ConfirmDialogResult) => {
      resolve(result.confirmed);
    });
    ipcRenderer.invoke(IPC.CONFIRM_OPEN, data);
  });
}

/**
 * 原生确认窗口，取代浏览器内置的 `confirm()`。
 *
 * @returns 用户是否点了确认；点右上角关闭或按 Esc 都算取消
 */
export function confirmDialog(
  options: Omit<ConfirmDialogData, 'channel' | 'mode'>,
): Promise<boolean> {
  return openConfirmDialog({ ...options, mode: 'confirm', channel: IPC.CONFIRM_RESULT });
}

/**
 * 原生提示窗口，取代浏览器内置的 `alert()`。
 *
 * 只用于告知结果（通常是失败原因），没有返回值。
 */
export async function alertDialog(
  options: Omit<ConfirmDialogData, 'channel' | 'mode'>,
): Promise<void> {
  await openConfirmDialog({ ...options, mode: 'alert', channel: IPC.CONFIRM_RESULT });
}
