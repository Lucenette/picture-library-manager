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
    "--app-bg-page": "#1e1f22",
    "--app-bg-surface": "#2b2d30",
    "--app-bg-header": "#26282c",
    "--app-bg-hover": "#2e3034",
    "--app-bg-active": "#323438",
    "--app-bg-track": "#323438",
    "--app-bg-disabled": "#1f2024",
    "--app-border": "#323438",
    "--app-border-subtle": "#26282c",
    "--app-border-strong": "#3e4044",
    "--app-border-hover": "#4a4c50",
    "--app-text-primary": "#eceef1",
    "--app-text-regular": "#d8dadd",
    "--app-text-secondary": "#b4b6ba",
    "--app-text-muted": "#82858b",
    "--app-text-disabled": "#7a7e84",
    "--app-text-soft": "#a0a3a9",
    "--app-text-faint": "#5e6065",
    "--app-text-ghost": "#3e4044",
    "--app-primary": "#3871e1",
    "--app-primary-hover": "#3265c9",
    "--app-on-primary": "#fff",
    "--app-success": "#388555",
    "--app-success-hover": "#2d774c",
    "--app-warning": "#f2c55c",
    "--app-danger": "#c75458",
    "--app-danger-hover": "#b34b4f",
    "--app-info": "#6e737a",
    "--app-tag-success-bg": "#1a3826",
    "--app-tag-success-border": "#2d5a3c",
    "--app-tag-success-text": "#4ab86a",
    "--app-tag-danger-bg": "#322023",
    "--app-tag-danger-border": "#542f32",
    "--app-tag-danger-text": "#c75458",
    "--app-tag-warning-bg": "#3e340e",
    "--app-tag-warning-border": "#6e590b",
    "--app-tag-warning-text": "#f2c55c",
    "--app-tag-info-bg": "#2e3034",
    "--app-tag-info-border": "#3e4044",
    "--app-tag-info-text": "#b4b6ba",
    "--app-tag-primary-bg": "#182a4d",
    "--app-tag-primary-border": "#2a4a85",
    "--app-tag-primary-text": "#6ea8ff",
    "--app-tag-similar-bg": "#12333f",
    "--app-tag-similar-border": "#1d5566",
    "--app-tag-similar-text": "#4cc8e8",
    "--app-viewer-bg": "#0d0d0d",
    "--app-viewer-surface": "#1a1a1a",
    "--app-viewer-text": "#c8cad0",
    "--app-viewer-text-dim": "rgba(255, 255, 255, 0.5)",
    "--app-viewer-text-bright": "rgba(255, 255, 255, 0.9)",
    "--app-viewer-fade": "rgba(26, 26, 26, 0)",
    "--app-accent": "#7aa2f7",
    "--app-bg-selected": "#232427",
    "--app-bg-highlight": "#1e2e45",
    "--app-border-highlight": "#2859b8",
    "--app-danger-tint": "rgba(199, 84, 88, 0.16)",
    "--app-overlay-scrim": "rgba(0, 0, 0, 0.65)",
    "--app-mask": "rgb(30 31 34 / 0.7)",
    "--app-shadow-dialog": "0 16px 48px rgb(0 0 0 / 0.4)",
    "--app-shadow-popup": "0 8px 24px rgba(0, 0, 0, 0.4)",
    "--app-shadow-tile": "0 10px 26px rgba(0, 0, 0, 0.8)",
    "--app-shadow-tile-hover": "0 12px 30px rgba(0, 0, 0, 0.85)",
    "--app-shadow-viewer": "0 4px 20px rgba(0, 0, 0, 0.7)",
    "--app-shadow-viewer-thumb": "0 2px 12px rgba(0, 0, 0, 0.4)",
    "--el-color-primary-light-1": "#5080e4",
    "--el-color-primary-light-2": "#688fe7",
    "--el-color-primary-light-3": "#809eea",
    "--el-color-primary-light-4": "#98aded",
    "--el-color-primary-light-5": "#b0bcf0",
    "--el-color-primary-light-6": "#c8cbf3",
    "--el-color-primary-light-7": "#e0daf6",
    "--el-color-primary-light-8": "#f0e9f9",
    "--el-color-primary-light-9": "#f5f0fc",
    "--el-color-primary-dark-1": "#3265c9",
    "--el-color-primary-dark-2": "#2c59b1",
    "--el-color-success-light-1": "#4c9163",
    "--el-color-success-light-2": "#609d71",
    "--el-color-success-light-3": "#74a97f",
    "--el-color-success-light-4": "#88b58d",
    "--el-color-success-light-5": "#9cc19b",
    "--el-color-success-light-6": "#b0cda9",
    "--el-color-success-light-7": "#c4d9b7",
    "--el-color-success-light-8": "#d8e5c5",
    "--el-color-success-light-9": "#ecf1d3",
    "--el-color-success-dark-1": "#32774b",
    "--el-color-success-dark-2": "#2c6941",
    "--el-color-warning-light-1": "#f4cb6d",
    "--el-color-warning-light-2": "#f5d17e",
    "--el-color-warning-light-3": "#f7d78f",
    "--el-color-warning-light-4": "#f8dda0",
    "--el-color-warning-light-5": "#fae3b1",
    "--el-color-warning-light-6": "#fbe9c2",
    "--el-color-warning-light-7": "#fcefd3",
    "--el-color-warning-light-8": "#fef5e4",
    "--el-color-warning-light-9": "#fefaf5",
    "--el-color-warning-dark-1": "#dab050",
    "--el-color-warning-dark-2": "#c29b48",
    "--el-color-danger-light-1": "#cd6569",
    "--el-color-danger-light-2": "#d3767a",
    "--el-color-danger-light-3": "#d9878b",
    "--el-color-danger-light-4": "#df989c",
    "--el-color-danger-light-5": "#e5a9ad",
    "--el-color-danger-light-6": "#ebbabe",
    "--el-color-danger-light-7": "#f1cbcf",
    "--el-color-danger-light-8": "#f7dce0",
    "--el-color-danger-light-9": "#fbf0f1",
    "--el-color-danger-dark-1": "#b34b4f",
    "--el-color-danger-dark-2": "#9f4246",
    "--el-color-info-light-1": "#7d8187",
    "--el-color-info-light-2": "#8b8f94",
    "--el-color-info-light-3": "#9a9da2",
    "--el-color-info-light-4": "#a8abaf",
    "--el-color-info-light-5": "#b7b9bc",
    "--el-color-info-light-6": "#c5c7c9",
    "--el-color-info-light-7": "#d4d5d7",
    "--el-color-info-light-8": "#e2e3e4",
    "--el-color-info-light-9": "#f1f1f2",
    "--el-color-info-dark-1": "#62676d",
    "--el-color-info-dark-2": "#565b60",
    "--el-text-color-placeholder": "#8e9196",
    "--el-text-color-disabled": "#5e6268",
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
