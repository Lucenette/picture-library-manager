// ============================================================
// 日志：log4js 配置与封装（主进程）
//
// 三个文件（root / external / script）的落盘规则都在这里，文件只有这一个写者；
// 其余来源把记录交过来：渲染进程走 IPC、worker 走 postMessage、用户脚本走 stdout 分流。
//
// 纯逻辑（占位符替换）在 common/log.ts；这个模块只做与运行环境相关的事。
// ============================================================

import { mkdirSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { app, ipcMain } from 'electron';
import log4js from 'log4js';
import type { Appender, Configuration, DateFileAppender, Layout, Logger as Log4jsLogger } from 'log4js';

import { IPC } from '@common/ipcChannels';
import { formatPlaceholders, type LogLevel, type LogRecord } from '@common/log';

import { getLogsDir } from '@/paths';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/** 单个日志文件的上限；压缩前的大小 */
const FILE_MAX_SIZE = 50 * 1024 * 1024;
/** 旧文件保留数：`numBackups` 把当天的分卷一起计入（实测 300 次分卷后正好 20 个） */
const FILE_BACKUPS = 20;
/** 按天保留的上限：log4js 的 `daysToKeep` 只是 `numBackups` 的弃用别名，按天的清理由启动时自己做 */
const KEEP_DAYS = 14;
/** 文件名里的日期格式：不能带前导点，否则会写成 `root.log..2026-09-29.gz` */
const DATE_PATTERN = 'yyyy-MM-dd';
/** 文件行格式：时间、级别、进程号、category（来源 + 进程角色 + 模块）、消息 */
const FILE_LAYOUT: Layout = {
  type: 'pattern',
  pattern: '%d{yyyy-MM-dd hh:mm:ss.SSS} %-5p [%z] [%c] %m',
};

/** 认得的级别；环境变量给别的值一律退回默认，不静默换成另一个级别 */
const LEVELS: readonly string[] = ['error', 'warn', 'info', 'debug'];

/** 我们自己的日志（主进程与渲染进程）都进 root.log，来源靠 category 区分 */
const ROOT_CATEGORIES = ['default', 'main', 'renderer'] as const;
/** 第三方与噪声 */
const EXTERNAL_CATEGORY = 'external';
/** 用户脚本里的 console.* */
const SCRIPT_CATEGORY = 'script';

/** 主进程侧的 logger：占位符形式，与渲染进程、用户脚本看到的 API 一致 */
export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

/** 除我们自己的日志之外的来源：第三方噪声与用户脚本 */
export type LogChannel = 'external' | 'script';

/** 日志正在写控制台：stdout/stderr 补丁看见它就只放行、不再记录，避免自我递归 */
let consoleWriting = false;
/** 当前通道：执行用户脚本期间切到 `script`，其余时候是 `external` */
let channel: LogChannel = 'external';

/** 补丁用：这一行控制台输出是不是日志自己写的 */
export function isConsoleWriteFromLogger(): boolean {
  return consoleWriting;
}

/** 补丁用：当前该记到哪个通道 */
export function getLogChannel(): LogChannel {
  return channel;
}

/**
 * 执行用户脚本期间把通道切到 `script`。
 *
 * 脚本里 `console.*` 的输出要单独进 `script.log`，而脚本调用期间是同步的，所以用标记分流；
 * 脚本若把 `console` 存下来异步打印，那类输出会落回 `external`（见 docs/design/logging.md 3.6）。
 */
export function withScriptLogChannel<T>(action: () => T): T {
  const previous = channel;
  channel = 'script';
  try {
    return action();
  } finally {
    channel = previous;
  }
}

// ------------------------------------------------------------
// 配置
// ------------------------------------------------------------

/** 从环境变量读级别；不认识的值退回默认 */
function readLevel(name: string, fallback: LogLevel): LogLevel {
  const raw = process.env[name] === undefined ? '' : String(process.env[name]).trim().toLowerCase();
  return LEVELS.includes(raw) ? (raw as LogLevel) : fallback;
}

/** 主进程自己的日志级别：开发态 debug、打包态 info */
function rootLevel(): LogLevel {
  return readLevel('PLM_LOG_LEVEL', app.isPackaged ? 'info' : 'debug');
}

/**
 * 文件 appender 的选项。
 *
 * log4js 的 `DateFileAppender` 类型里漏了 `maxLogSize`——它把未知选项直通给 streamroller，
 * 实测按大小分卷有效（超过阈值就在当天内继续分卷），所以这里补上声明。
 */
type FileAppenderOptions = DateFileAppender & { maxLogSize?: number };

/** 一个日志文件的 appender：按天滚动、超过 50 MB 继续分卷、旧文件 gzip 压缩 */
function fileAppender(name: string): FileAppenderOptions {
  return {
    type: 'dateFile',
    filename: join(getLogsDir(), name),
    pattern: DATE_PATTERN,
    maxLogSize: FILE_MAX_SIZE,
    numBackups: FILE_BACKUPS,
    compress: true,
    keepFileExt: false,
    encoding: 'utf-8',
    layout: FILE_LAYOUT,
  };
}

/**
 * 控制台：开发态彩色、打包态纯文本。
 *
 * 不按 TTY 判断而按是否打包判断：log4js 的 `colored` 不探测 TTY，命令行重定向时会留下转义码。
 */
function consoleAppender(): Appender {
  const layout: Layout = app.isPackaged ? { type: 'basic' } : { type: 'colored' };
  return { type: 'console', layout };
}

/** 三个来源共用一套结构：文件（INFO 及以上）+ 控制台（各自级别） */
function buildConfiguration(root: LogLevel, external: LogLevel, script: LogLevel): Configuration {
  const rootCategory = { appenders: ['rootFileInfo', 'console'], level: root };
  return {
    appenders: {
      rootFile: fileAppender('root.log'),
      rootFileInfo: { type: 'logLevelFilter', level: 'info', appender: 'rootFile' },
      externalFile: fileAppender('external.log'),
      scriptFile: fileAppender('script.log'),
      console: consoleAppender(),
    },
    categories: {
      main: rootCategory,
      renderer: rootCategory,
      default: rootCategory,
      external: { appenders: ['externalFile', 'console'], level: external },
      script: { appenders: ['scriptFile', 'console'], level: script },
    },
  };
}

// ------------------------------------------------------------
// 初始化与收尾
// ------------------------------------------------------------

/** 配过了就不再配：重复 `configure` 会重建 appender 与文件流 */
let configured = false;

/**
 * 删掉超过 KEEP_DAYS 的旧日志。
 *
 * log4js 只按文件数保留（`numBackups`），按天这条得自己做；单个文件失败不影响其它。
 */
async function cleanupOldLogs(): Promise<void> {
  const dir = getLogsDir();
  const deadline = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith('.gz')) {
      continue;
    }
    const full = join(dir, name);
    try {
      const info = await stat(full);
      if (info.mtimeMs < deadline) {
        await unlink(full);
      }
    } catch {
      // 单个文件删不掉就算了，不影响其它文件
    }
  }
}

/**
 * 初始化日志。
 *
 * 必须在任何可能失败的事情之前调用（开库、建窗口），所以它**不能**登记成加载服务的任务：
 * 加载服务自己还在初始化它，而它要能记录加载服务的失败。这是启动顺序里唯一的例外。
 */
export function initLogging(): void {
  if (configured) {
    return;
  }
  configured = true;

  try {
    mkdirSync(getLogsDir(), { recursive: true });
  } catch {
    // 建不出来也让 log4js 去试：失败会出现在控制台与调用处，不在这里吞掉
  }

  log4js.configure(buildConfiguration(
    rootLevel(),
    readLevel('PLM_LOG_LEVEL_EXTERNAL', 'warn'),
    readLevel('PLM_LOG_LEVEL_SCRIPT', 'warn'),
  ));

  void cleanupOldLogs();

  log4js.getLogger('main.log').info('logging started, dir: {}', getLogsDir());
}

/** 退出前 flush：dateFile 是异步写，等它落完再关库 */
export function flushLogging(done: () => void): void {
  if (!configured) {
    done();
    return;
  }
  log4js.shutdown(() => done());
}

// ------------------------------------------------------------
// 封装
// ------------------------------------------------------------

/** 按完整 category 建 logger（worker 与 IPC 转交的记录也用它） */
function loggerOf(category: string): Logger {
  const target = log4js.getLogger(category);
  const at = (level: LogLevel) => (message: string, ...args: unknown[]): void => {
    // 级别短路放在拼装之前：debug 关掉时连字符串都不拼
    if (!target.isLevelEnabled(level)) {
      return;
    }
    write(target, level, formatPlaceholders(message, args));
  };
  return { error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug') };
}

/** 一个模块一个 logger：category 形如 `main.scan`、`renderer.editor` */
export function createLogger(module: string, role: 'main' | 'renderer' = 'main'): Logger {
  return loggerOf(role + '.' + module);
}

/** 落一条别人送来的记录：渲染进程经 IPC、worker 经 postMessage */
export function writeRecord(record: LogRecord): void {
  const target = log4js.getLogger(record.category);
  if (!target.isLevelEnabled(record.level)) {
    return;
  }
  write(target, record.level, record.message);
}

/**
 * 真正落一条记录。
 *
 * 写之前把「日志正在写控制台」的标记立起来：控制台 appender 会写 stdout，而 stdout 补丁正盯着它，
 * 不立标记就会自己收自己、同一行进两个文件。
 */
function write(target: Log4jsLogger, level: LogLevel, message: string): void {
  consoleWriting = true;
  try {
    target[level](message);
  } finally {
    consoleWriting = false;
  }
}

/**
 * 渲染进程的记录入口。
 *
 * 只收记录、不落自己的文件：文件由主进程独占写入。级别与 category 做一次粗校验，
 * 免得脏数据在 log4js 里建出一堆没意义的 category。
 */
export function initLogIpc(): void {
  ipcMain.on(IPC.LOG_WRITE, (_event, record: LogRecord) => {
    if (typeof record?.category !== 'string' || record.category === '') {
      return;
    }
    if (!LEVELS.includes(record.level)) {
      return;
    }
    writeRecord(record);
  });
}

/** 三个来源的 category 前缀，给捕获层拼 category 用 */
export const CATEGORY = {
  rootCategories: ROOT_CATEGORIES,
  external: EXTERNAL_CATEGORY,
  script: SCRIPT_CATEGORY,
} as const;
