import { DEFAULT_THEME, resolveTheme, type Theme } from '@common/theme';

import { createLogger } from '@/services/log-service';

/** 本模块的日志（category `renderer.theme`） */
const log = createLogger('theme');

/** 主题变化的订阅者；注册时立刻会用当前主题调一次 */
export type ThemeHandler = (theme: Theme) => void;

const handlers = new Set<ThemeHandler>();
let current: Theme = resolveTheme(DEFAULT_THEME, window.matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * 应用一套主题：先把令牌写进 `:root`，再依次通知订阅者。
 *
 * 处理器之间**互不依赖**——它们从 theme 对象取值、不从 DOM 里读，所以不需要约定先后。
 * 设置页落地前只有一套主题，入口初始化时由 `initTheme()` 跑一次。
 */
export function applyTheme(theme: Theme): void {
  current = theme;
  for (const [name, value] of Object.entries(theme.tokens)) {
    // 某套主题可以少给键（例如浅色不覆盖 --el-* 色阶，交给 Element Plus 自带的浅色默认），跳过即可
    if (value !== undefined) {
      document.documentElement.style.setProperty(name, value);
    }
  }
  for (const handler of handlers) {
    try {
      handler(theme);
    } catch (error) {
      // 一个处理器失败不能带走其余、也不能带走启动：界面照旧，但日志里要看得见
      log.error('theme handler failed', error);
    }
  }
}

/**
 * 注册主题处理器；返回注销函数（组件在 `onBeforeUnmount` 里调）。
 *
 * 注册时立刻用当前主题调一次，调用方不必自己再写一遍初始化分支。
 */
export function onThemeChange(handler: ThemeHandler): () => void {
  handlers.add(handler);
  handler(current);
  return () => {
    handlers.delete(handler);
  };
}

/**
 * 入口初始化：按偏好挂上主题，并在系统切换明暗时**立刻**跟着换。
 *
 * 「跟随系统」在这里落成一条 matchMedia 监听：系统一切换就重新解析并应用，已注册的处理器
 * （编辑器等）跟着重定义——不需要重启，也不需要主进程广播，两端各自听同一个系统事件。
 */
export function initTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(resolveTheme(DEFAULT_THEME, query.matches));
  query.addEventListener('change', (event) => {
    log.info('system appearance changed, reapplying theme: ' + (event.matches ? 'dark' : 'light'));
    applyTheme(resolveTheme(DEFAULT_THEME, event.matches));
  });
}
