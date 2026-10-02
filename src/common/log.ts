// ============================================================
// 日志：跨进程共用的部分
//
// 这里只有契约与纯函数：`Logger` 是主进程与渲染进程共用的 API，`formatCause()` 把附带的
// 原因拼成文本。落盘、轮转、级别控制都在主进程（见 src/main/log/）。
// ============================================================

/** 日志级别；与 log4js 的级别名一致（小写） */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** 一条日志记录：渲染进程与 worker 把它交给主进程落盘 */
export interface LogRecord {
  /** 完整 category，形如 `main.scan`、`renderer.editor`、`external.console-renderer` */
  category: string;
  level: LogLevel;
  /** 已经拼好的最终文本 */
  message: string;
}

/**
 * 两边一致的 logger：消息自己拼，`cause` 只用来附带一个原因对象。
 *
 * 消息用模板字符串就地拼好（`log.error(`open failed: ${path}`, error)`），不引入占位符——
 * 位置参数那一套是 Java 的习惯；`cause` 也不是位置替换，它只是在消息后面补一段
 * （Error 给栈，对象给 JSON）。
 */
export interface Logger {
  error(message: string, cause?: unknown): void;
  warn(message: string, cause?: unknown): void;
  info(message: string, cause?: unknown): void;
  debug(message: string, cause?: unknown): void;
}

/**
 * 把附带的「原因」拼成一行文本。
 *
 * Error 给栈：打包态没有文件行号，栈是唯一能说明「从哪抛出来的」的东西；
 * 其它对象给 JSON，其余交给 String()。
 */
export function formatCause(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      // 循环引用、BigInt 这类序列化不了的值，给一个明确标记，别落成 [object Object]
      return '[unserializable]';
    }
  }
  return String(value);
}
