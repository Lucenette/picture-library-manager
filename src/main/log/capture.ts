// ============================================================
// 日志：兜底捕获
//
// 收那些我们没主动记录的输出：
//   · stdout / stderr 补丁——第三方库、Electron 与 Node 自己打的东西；执行用户脚本期间走 script 通道；
//   · 渲染进程的 console——框架警告、Vue 的提示；
//   · 进程消失这类硬事件。
//
// 不接管 uncaughtException / unhandledRejection：Node 与 Electron 本来就会把堆栈打到 stderr，
// 补丁已经能收进日志；自己加处理器反而会改掉「未捕获异常即退出」的既有行为。
// ============================================================

import { app } from 'electron';

import type { LogLevel } from '@common/log';

import { CATEGORY, getLogChannel, isConsoleWriteFromLogger, writeRecord } from '@/log/logger';

/** 这条输出该记到哪个 category：执行用户脚本期间统一进 script */
function categoryOf(source: 'stdout' | 'stderr'): string {
  return getLogChannel() === 'script' ? CATEGORY.script : CATEGORY.external + '.' + source;
}

/** 级别：stdout 当 info、stderr 当 error（console.error 与 console.warn 都走 stderr，分不开） */
function levelOf(source: 'stdout' | 'stderr'): LogLevel {
  return source === 'stderr' ? 'error' : 'info';
}

/** 把 stdout / stderr 的原始 write 换成「先照原样写出去，再记一条」 */
function patchStream(stream: NodeJS.WriteStream, source: 'stdout' | 'stderr'): void {
  const original = stream.write.bind(stream);
  const patched = (chunk: unknown, ...rest: unknown[]): boolean => {
    const result = (original as unknown as (value: unknown, ...extra: unknown[]) => boolean)(chunk, ...rest);
    if (!isConsoleWriteFromLogger()) {
      const text = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed !== '') {
          writeRecord({ category: categoryOf(source), level: levelOf(source), message: trimmed });
        }
      }
    }
    return result;
  };
  stream.write = patched;
}

/** 渲染进程 console 的级别名换成我们的四个级别 */
function levelOfConsole(level: 'info' | 'warning' | 'error' | 'debug'): LogLevel {
  return level === 'warning' ? 'warn' : level;
}

/** 渲染进程的 console：Electron 会把每条调用的内容、级别与来源一起送过来 */
function watchRendererConsole(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (details) => {
      const where = details.sourceId === '' ? '' : ' (' + details.sourceId + ':' + details.lineNumber + ')';
      writeRecord({
        category: CATEGORY.external + '.console-renderer',
        level: levelOfConsole(details.level),
        message: details.message + where,
      });
    });
    contents.on('preload-error', (_event, preloadPath, error) => {
      writeRecord({
        category: 'main.app',
        level: 'error',
        message: 'preload failed: ' + preloadPath + ': ' + error.message,
      });
    });
  });
}

/** 进程消失这类硬事件进 root.log：它们是我们的诊断依据，不是第三方噪声 */
function watchProcessEvents(): void {
  app.on('render-process-gone', (_event, contents, details) => {
    writeRecord({
      category: 'main.app',
      level: 'error',
      message: 'render process gone: reason=' + details.reason + ', exitCode=' + details.exitCode + ', url=' + contents.getURL(),
    });
  });
  app.on('child-process-gone', (_event, details) => {
    writeRecord({
      category: 'main.app',
      level: 'error',
      message: 'child process gone: type=' + details.type + ', reason=' + details.reason + ', exitCode=' + details.exitCode,
    });
  });
}

/**
 * 装上兜底捕获。
 *
 * 必须在 `initLogging()` 之后调用：补丁只会把内容交给已经配好的 logger。
 */
export function installLogCapture(): void {
  patchStream(process.stdout, 'stdout');
  patchStream(process.stderr, 'stderr');
  watchRendererConsole();
  watchProcessEvents();
}
