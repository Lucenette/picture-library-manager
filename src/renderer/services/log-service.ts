import { ipcRenderer } from 'electron';

import { IPC } from '@common/ipcChannels';
import { formatCause, type LogLevel, type Logger, type LogRecord } from '@common/log';

/**
 * 一个模块一个 logger：category 形如 `renderer.editor`。
 *
 * 消息与 `cause` 在这里就地拼成最终文本（纯函数，见 common/log.ts），主进程只负责落盘；
 * 级别过滤由主进程按 category 决定，这里不做判断。
 */
export function createLogger(module: string): Logger {
  const category = 'renderer.' + module;
  const at = (level: LogLevel) => (message: string, cause?: unknown): void => {
    const record: LogRecord = {
      category,
      level,
      message: cause === undefined ? message : `${message} (${formatCause(cause)})`,
    };
    ipcRenderer.send(IPC.LOG_WRITE, record);
  };
  return { error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug') };
}
