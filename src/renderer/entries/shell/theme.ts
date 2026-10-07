import { ipcRenderer } from 'electron';

import { IPC } from '@common/ipcChannels';
import { isThemeName, type Settings } from '@common/settings';
import { DEFAULT_THEME, resolveTheme, type Theme, type ThemeName } from '@common/theme';

import { createLogger } from '@/services/log-service';

/** 本模块的日志（category `renderer.theme`） */
const log = createLogger('theme');

/** 主题变化的订阅者；注册时立刻会用当前主题调一次 */
export type ThemeHandler = (theme: Theme) => void;

const handlers = new Set<ThemeHandler>();
/** 当前偏好：主进程建窗口时经 URL 带进来，之后跟着设置变化走 */
let preference: ThemeName = DEFAULT_THEME;
let current: Theme = resolveTheme(DEFAULT_THEME, window.matchMedia('(prefers-color-scheme: dark)').matches);
/** 上一套写进 `<html>` 的键：换主题时要把新主题没有的删掉，否则内联变量会压住新主题应有的默认值 */
let applied: string[] = [];

/** 系统是否偏好暗色：只有「跟随系统」才看它，指定了某一套时由 `resolveTheme` 自己定 */
function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 按当前偏好解析并应用 */
function applyPreference(): void {
  applyTheme(resolveTheme(preference, systemPrefersDark()));
}

/**
 * 应用一套主题：先把令牌写进 `:root`，再依次通知订阅者。
 *
 * 处理器之间**互不依赖**——它们从 theme 对象取值、不从 DOM 里读，所以不需要约定先后。
 */
export function applyTheme(theme: Theme): void {
  current = theme;
  const next: string[] = [];
  for (const [name, value] of Object.entries(theme.tokens)) {
    // 某套主题可以少给键（例如浅色不覆盖 --el-* 色阶，交给 Element Plus 自带的浅色默认），跳过即可
    if (value !== undefined) {
      document.documentElement.style.setProperty(name, value);
      next.push(name);
    }
  }
  // 内联变量优先级最高：新主题没给的键必须删掉，否则暗→亮会留着上一套的 --el-*
  const nextSet = new Set(next);
  for (const name of applied) {
    if (!nextSet.has(name)) {
      document.documentElement.style.removeProperty(name);
    }
  }
  applied = next;
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
 * 入口初始化：按主进程带的偏好挂上主题，之后跟着设置变化与系统明暗走。
 *
 * 偏好经窗口 URL 的 `?theme=` 带进来（见 `window-manager` 的 `getWindowUrl`）：它必须在首帧之前
 * 就有值，挂载后再去问主进程会先闪一下系统主题。缺参数只可能是有人直接打开了那个 HTML，
 * 按默认值兜底并记一条 warn。
 *
 * 四个入口都要调它（经 `initWindowChrome`），所以每个窗口——含查看器、浮窗与各类弹窗——都会
 * 收到设置广播，切换主题不需要重启、也不会漏掉哪个窗口。
 */
export function initTheme(): void {
  const fromUrl = new URLSearchParams(window.location.search).get('theme');
  if (fromUrl === null) {
    log.warn('window url has no theme parameter, falling back to ' + DEFAULT_THEME);
  }
  preference = isThemeName(fromUrl) ? fromUrl : DEFAULT_THEME;
  applyPreference();

  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', (event) => {
    // 只有「跟随系统」才理会系统明暗：指定了某一套时系统怎么变都与界面无关
    if (preference !== 'system') {
      return;
    }
    log.info('system appearance changed, reapplying theme: ' + (event.matches ? 'dark' : 'light'));
    applyPreference();
  });

  ipcRenderer.on(IPC.SETTINGS_CHANGED, (_event, settings: Settings) => {
    preference = settings.theme;
    applyPreference();
  });
}
