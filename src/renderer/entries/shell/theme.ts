import { DEFAULT_THEME, THEMES, type Theme } from '@common/theme';

import { createLogger } from '@/services/log-service';

/** 本模块的日志（category `renderer.theme`） */
const log = createLogger('theme');

/** 主题变化的订阅者；注册时立刻会用当前主题调一次 */
export type ThemeHandler = (theme: Theme) => void;

const handlers = new Set<ThemeHandler>();
let current: Theme = THEMES[DEFAULT_THEME];

/**
 * 应用一套主题：先把令牌写进 `:root`，再依次通知订阅者。
 *
 * 处理器之间**互不依赖**——它们从 theme 对象取值、不从 DOM 里读，所以不需要约定先后。
 * 设置页落地前只有一套主题，入口初始化时由 `initTheme()` 跑一次。
 */
export function applyTheme(theme: Theme): void {
  current = theme;
  for (const [name, value] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(name, value);
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

/** 入口初始化：把默认主题挂上（四个入口都经 `initWindowChrome()` 调到） */
export function initTheme(): void {
  applyTheme(THEMES[DEFAULT_THEME]);
}
