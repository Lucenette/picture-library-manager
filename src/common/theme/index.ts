import { dark } from './dark';
import { light } from './light';
import { resolveSystemTheme } from './system';
import type { Theme, ThemeName } from './types';

export type { MonacoTheme, Theme, ThemeName } from './types';
export { dark, light };

/** 静态主题：一套一个文件；加主题就是再加一个文件并登记到这里 */
export const THEMES = { dark, light } as const;

/** 全部主题名，含动态的 system */
export const THEME_NAMES: readonly ThemeName[] = ['dark', 'light', 'system'];

/** 默认主题：设置页落地前固定暗色，避免改变现有外观 */
export const DEFAULT_THEME = 'dark';

/**
 * 把主题名解析成一套具体主题——主体系统只需要调这一个函数。
 *
 * system 是动态的：由调用方把当前系统的明暗状态传进来（见 system.ts）。
 */
export function resolveTheme(name: ThemeName, systemPrefersDark: boolean): Theme {
  if (name === 'system') {
    return resolveSystemTheme(systemPrefersDark);
  }
  return THEMES[name];
}
