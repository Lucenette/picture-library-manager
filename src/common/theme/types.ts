/** 一套主题里交给 Monaco 的那部分：`base` 决定语法底，`rules` 是逐 token 的着色，`colors` 是编辑器配色 */
export interface MonacoTheme {
  readonly base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  readonly rules: readonly unknown[];
  readonly colors: Readonly<Record<string, string>>;
}

/** 一套主题：令牌（键是 CSS 变量名）+ 编辑器自己那份配置（它只认字符串色值） */
export interface Theme<TTokens = Record<string, string>> {
  readonly tokens: Partial<Record<keyof TTokens, string>>;
  readonly monaco: MonacoTheme;
}

/** 主题名：三套静态 + 跟随系统 */
export type ThemeName = 'dark' | 'light' | 'system';
