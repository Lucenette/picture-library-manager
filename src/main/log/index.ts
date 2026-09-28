// ============================================================
// 日志模块出口
//
// 对外只露这几件：初始化、flush、建 logger、落别人送来的记录。
// ============================================================

export { initLogging, flushLogging, createLogger, writeRecord, CATEGORY } from '@/log/logger';
export type { Logger } from '@/log/logger';
