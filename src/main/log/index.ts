// ============================================================
// 日志模块出口
//
// 对外只露这几件：一次装好（setupLogging）、flush、建 logger、落别人送来的记录。
// ============================================================

import { installLogCapture } from '@/log/capture';
import { initLogIpc, initLogging } from '@/log/logger';

/**
 * 一次装好日志。
 *
 * 顺序固定：先配 log4js（后面两步都依赖它），再装兜底捕获，最后挂渲染进程的入口。
 */
export function setupLogging(): void {
  initLogging();
  installLogCapture();
  initLogIpc();
}

export {
  CATEGORY, createLogger, flushLogging, getLogChannel, initLogging, isConsoleWriteFromLogger, withScriptLogChannel,
  writeRecord,
} from '@/log/logger';
export type { LogChannel, Logger } from '@/log/logger';
