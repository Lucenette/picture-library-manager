import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import { getSimilarData } from '@/database/db';
import { createSimilar } from '@/window-manager';

/**
 * 相似图片识别结果窗口。
 *
 * 结果在库里，窗口自己通过 similar:data 来拉，主进程不主动推——所以窗口随时
 * 打开看到的都是最近一次识别的结果，重启应用也还在。
 */
export function initSimilar(): void {
  ipcMain.handle(IPC.SIMILAR_OPEN, () => {
    createSimilar();
  });

  ipcMain.handle(IPC.SIMILAR_DATA, () => getSimilarData());
}
