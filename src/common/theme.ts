/**
 * 主题：颜色与尺寸的**唯一来源**。
 *
 * 放 common 是因为两个进程都要用：渲染进程把它写成 `:root` 的 CSS 变量（界面本体），主进程拿窗口底色与
 * 系统按钮字形色（它读不到 CSS），编辑器拿它自己的主题（它只认字符串色值）。组件与样式表里不许再出现
 * 色值——由 test/renderer 的样式表扫描用例守着。
 *
 * 加一套主题 = 在 `THEMES` 里加一个键完全一致的条目（键由第一套推出，少键是编译错误）。现在只有暗色一套；
 * 浅色与切换依赖设置页，见 docs/roadmap/theme.md。
 */

/** 暗色（IDEA Darcula）的令牌；键是 CSS 变量名，值是它当前的字面值 */
const darkTokens = {
  /* ---- 尺寸：与主题正交，但和颜色一样只有这一处来源 ---- */
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
} as const;

/** 一套主题：令牌 + 编辑器自己那份配置（编辑器只认字符串，读不了 CSS 变量） */
export interface Theme {
  /** 键是 CSS 变量名；写进 `:root` 后整个界面跟着变 */
  readonly tokens: { readonly [K in keyof typeof darkTokens]: string };
  /** 交给 Monaco 的 `defineTheme`：`rules` 是语法着色，`colors` 是编辑器配色 */
  readonly monaco: {
    readonly base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
    readonly rules: readonly unknown[];
    readonly colors: Readonly<Record<string, string>>;
  };
}

const dark: Theme = {
  tokens: darkTokens,
  monaco: {
    base: 'vs-dark',
    // 语法着色的第一版交给 base 继承；浅色落地时只补与界面冲突的几条
    rules: [],
    colors: {
      'editor.background': darkTokens['--app-bg-page'],
      'editorGutter.background': darkTokens['--app-bg-page'],
      'editor.lineHighlightBackground': darkTokens['--app-bg-header'],
      'editorLineNumber.foreground': darkTokens['--app-text-faint'],
      'editorLineNumber.activeForeground': darkTokens['--app-text-soft'],
    },
  },
};

/** 现有主题；将来浅色加在这里 */
export const THEMES: Record<'dark', Theme> = { dark };

/** 主题名 */
export type ThemeName = keyof typeof THEMES;

/** 默认主题：设置页落地前只有它 */
export const DEFAULT_THEME: ThemeName = 'dark';
