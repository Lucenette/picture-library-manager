import { dark } from './dark';
import { light } from './light';
import type { Theme } from './types';

/**
 * 跟随系统不是一个静态主题：它引入亮色与暗色两套，按系统当前的明暗返回其中一套。
 *
 * 系统状态由调用方传进来——主进程用 nativeTheme.shouldUseDarkColors，渲染进程用
 * matchMedia 的 prefers-color-scheme；common 里不引 electron、也不碰 DOM。
 */
export function resolveSystemTheme(systemPrefersDark: boolean): Theme {
  return systemPrefersDark ? dark : light;
}
