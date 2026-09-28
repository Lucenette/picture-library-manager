// ============================================================
// 日志模块出口
//
// 对外只露这几件：初始化、flush、建 logger、落别人送来的记录。
// ============================================================

export {
  CATEGORY, createLogger, flushLogging, getLogChannel, initLogging, isConsoleWriteFromLogger, withScriptLogChannel,
  writeRecord,
} from '@/log/logger';
export { installLogCapture } from '@/log/capture';
export type { LogChannel, Logger } from '@/log/logger';
