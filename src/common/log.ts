// ============================================================
// 日志：跨进程共用的部分
//
// 这里只有类型与纯函数——主进程要用它拼消息，渲染进程也要（两边 API 一致）。
// 落盘、轮转、级别控制都在主进程（见 src/main/log/）。
// ============================================================

/** 日志级别；与 log4js 的级别名一致（小写） */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** 一条日志记录：渲染进程与 worker 把它交给主进程落盘 */
export interface LogRecord {
  /** 完整 category，形如 `main.scan`、`renderer.editor`、`external.console-renderer` */
  category: string;
  level: LogLevel;
  /** 已经替换过占位符的最终文本 */
  message: string;
}

/** 占位符：Java 那一套 `{}`，按顺序吃参数 */
const PLACEHOLDER = '{}';

/**
 * 把 `{}` 逐个替换成参数。
 *
 * 参数多于占位符时忽略多余项（与 SLF4J 一致）；少于占位符时原样留下 `{}`，
 * 拼错了能一眼看出来，而不是悄悄少一段。
 */
export function formatPlaceholders(template: string, args: readonly unknown[]): string {
  let index = 0;
  let result = '';
  let cursor = 0;

  while (cursor < template.length) {
    const at = template.indexOf(PLACEHOLDER, cursor);
    if (at < 0) {
      result += template.slice(cursor);
      break;
    }
    result += template.slice(cursor, at);
    if (index < args.length) {
      result += stringify(args[index]);
      index += 1;
    } else {
      result += PLACEHOLDER;
    }
    cursor = at + PLACEHOLDER.length;
  }
  return result;
}

/** 参数转文本：Error 给消息与栈，对象给 JSON，其余交给 String() */
function stringify(value: unknown): string {
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
      return String(value);
    }
  }
  return String(value);
}
