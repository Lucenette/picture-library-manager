import { ipcRenderer } from 'electron';

import { IPC } from '@common/ipcChannels';
import { formatPlaceholders, type LogLevel, type LogRecord } from '@common/log';

/** 渲染进程侧的 logger：API 与主进程完全一致，记录经 IPC 交给主进程落盘 */
export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * 一个模块一个 logger：category 形如 `renderer.editor`。
 *
 * 占位符替换在这里就地做完（纯函数，见 common/log.ts），主进程只负责落盘；
 * 级别过滤由主进程按 category 决定，这里不做判断。
 */
export function createLogger(module: string): Logger {
  const category = 'renderer.' + module;
  const at = (level: LogLevel) => (message: string, ...args: unknown[]): void => {
    const record: LogRecord = { category, level, message: formatPlaceholders(message, args) };
    ipcRenderer.send(IPC.LOG_WRITE, record);
  };
  return { error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug') };
}
