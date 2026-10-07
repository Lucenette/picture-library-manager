import { darkTokens } from './dark';
import type { Theme } from './types';

/**
 * 浅色的令牌。
 *
 * 界面部分照 WebStorm 的 Islands Light 实测值（chrome e9eaee、面板与编辑器 ffffff）与 Light.icls 里的
 * 文字／分隔线／选区（080808 / 8c8c8c / ebecf0 / a6d2ff / f5f8fe / aeb3c2）铺出来；编辑器与语法全部照 Light.icls。
 * 查看器保持深底中性灰：图片区域不跟主题。
 *
 * 这里不覆盖 --el-* 色阶——Element Plus 自带的浅色默认就是浅色下合适的，只有品牌主色靠 CSS 里的映射跟着走。
 */
export const light: Theme<typeof darkTokens> = {
  tokens: {
    "--app-space-2": "2px",
    "--app-space-4": "4px",
    "--app-space-6": "6px",
    "--app-space-8": "8px",
    "--app-space-10": "10px",
    "--app-space-12": "12px",
    "--app-space-16": "16px",
    "--app-space-20": "20px",
    "--app-space-24": "24px",
    "--app-space-32": "32px",
    "--app-radius-2": "2px",
    "--app-radius-4": "4px",
    "--app-radius-6": "6px",
    "--app-radius-8": "8px",
    "--app-font-xs": "11px",
    "--app-font-sm": "12px",
    "--app-font-base": "13px",
    "--app-font-md": "14px",
    "--app-font-lg": "16px",
    "--app-bg-page": "#f7f8f9",
    "--app-bg-surface": "#ffffff",
    "--app-bg-header": "#e9eaee",
    "--app-bg-hover": "#00000012",
    "--app-bg-active": "#e3ebfe",
    "--app-bg-track": "#ebecf0",
    "--app-bg-disabled": "#f7f8f9",
    "--app-border": "#d1d1d1",
    "--app-border-subtle": "#e9eaee",
    "--app-border-strong": "#c4c4c4",
    "--app-border-hover": "#b9bdc9",
    "--app-text-primary": "#000000",
    "--app-text-regular": "#27282e",
    "--app-text-secondary": "#383a42",
    "--app-text-muted": "#8c8c8c",
    "--app-text-disabled": "#6c707e",
    "--app-text-soft": "#494b57",
    "--app-text-faint": "#a8adbd",
    "--app-text-ghost": "#d3d5db",
    "--app-primary": "#3871e1",
    "--app-primary-hover": "#3369d6",
    "--app-on-primary": "#ffffff",
    "--app-success": "#208a3c",
    "--app-success-hover": "#1f8039",
    "--app-warning": "#fdbd3d",
    "--app-danger": "#e55765",
    "--app-danger-hover": "#db3b4b",
    "--app-info": "#5a5d6b",
    "--app-tag-success-bg": "#e3f7e7",
    "--app-tag-success-border": "#89c398",
    "--app-tag-success-text": "#1f8039",
    "--app-tag-danger-bg": "#ffebec",
    "--app-tag-danger-border": "#f2b6bb",
    "--app-tag-danger-text": "#cc3645",
    "--app-tag-warning-bg": "#fff5db",
    "--app-tag-warning-border": "#fee6b1",
    "--app-tag-warning-text": "#df9303",
    "--app-tag-info-bg": "#f7f8fa",
    "--app-tag-info-border": "#d3d5db",
    "--app-tag-info-text": "#383a42",
    "--app-tag-primary-bg": "#edf3ff",
    "--app-tag-primary-border": "#a0bdf8",
    "--app-tag-primary-text": "#3369d6",
    "--app-tag-similar-bg": "#f2fcfc",
    "--app-tag-similar-border": "#b6e4e5",
    "--app-tag-similar-text": "#058b90",
    "--app-viewer-bg": "#d3d5db",
    "--app-viewer-surface": "#ffffff",
    "--app-viewer-text": "#27282e",
    "--app-viewer-text-dim": "rgba(0, 0, 0, 0.45)",
    "--app-viewer-text-bright": "#000000",
    "--app-viewer-fade": "rgba(255, 255, 255, 0)",
    "--app-accent": "#2470b3",
    "--app-bg-selected": "#d0dffe",
    "--app-bg-highlight": "#e3ebfe",
    "--app-border-highlight": "#a0bdf8",
    "--app-danger-tint": "#e5576520",
    "--app-overlay-scrim": "rgba(0, 0, 0, 0.45)",
    "--app-mask": "rgba(255, 255, 255, 0.7)",
    "--app-shadow-dialog": "0 16px 48px rgba(0, 0, 0, 0.18)",
    "--app-shadow-popup": "0 8px 24px rgba(0, 0, 0, 0.18)",
    "--app-shadow-tile": "0 10px 26px rgba(0, 0, 0, 0.3)",
    "--app-shadow-tile-hover": "0 12px 30px rgba(0, 0, 0, 0.35)",
    "--app-shadow-viewer": "0 4px 20px rgba(0, 0, 0, 0.25)",
    "--app-shadow-viewer-thumb": "0 2px 12px rgba(0, 0, 0, 0.2)",
  },
  monaco: {
    base: 'vs',
    rules: [
      // 通用词元名：内置词法器与 TextMate 失败时的降级路径，以及 TS 语义高亮都走它们
      { token: 'comment', foreground: '8c8c8c', fontStyle: 'italic' },
      { token: 'keyword', foreground: '0033b3' },
      { token: 'string', foreground: '067d17' },
      { token: 'number', foreground: '1750eb' },
      { token: 'constant', foreground: '871094', fontStyle: 'italic' },
      { token: 'function', foreground: '00627a' },
      { token: 'type', foreground: '00627a' },
      { token: 'variable', foreground: '000000' },
      { token: 'operator', foreground: '080808' },
      { token: 'delimiter', foreground: '080808' },
      // TextMate 作用域（source.js）：色值与字形取自 WebStorm 的 Light 配色（editor/Light.json）；
      // 行尾注释是对应的 JetBrains 属性名，font 是它的 FONT_TYPE（1 粗体、2 斜体、3 粗斜体）。
      // 这套方案区分度的很大一部分来自斜体/粗体，不只是颜色——只取色会显得比暗色平。
      { token: 'comment.line', foreground: '8c8c8c', fontStyle: 'italic' }, // DEFAULT_LINE_COMMENT
      { token: 'comment.block', foreground: '8c8c8c', fontStyle: 'italic' }, // DEFAULT_BLOCK_COMMENT
      { token: 'comment.block.documentation', foreground: '8c8c8c', fontStyle: 'italic' }, // DEFAULT_DOC_COMMENT
      { token: 'storage.type', foreground: '0033b3' }, // DEFAULT_KEYWORD
      { token: 'storage.modifier', foreground: '0033b3' }, // DEFAULT_KEYWORD
      { token: 'keyword.operator', foreground: '000000' }, // DEFAULT_OPERATION_SIGN 未设
      { token: 'string.regexp', foreground: '264eff' }, // JS.REGEXP
      { token: 'constant.numeric', foreground: '1750eb' }, // DEFAULT_NUMBER
      { token: 'constant.character.escape', foreground: '0037a6', fontStyle: 'bold' }, // DEFAULT_VALID_STRING_ESCAPE
      { token: 'constant.language', foreground: '871094', fontStyle: 'italic' }, // DEFAULT_CONSTANT
      { token: 'entity.name.function', foreground: '00627a' }, // DEFAULT_FUNCTION_DECLARATION
      { token: 'support.function', foreground: '00627a', fontStyle: 'italic' }, // DEFAULT_STATIC_METHOD
      { token: 'entity.name.type', foreground: '000000' }, // DEFAULT_CLASS_REFERENCE 未设
      { token: 'entity.other.inherited-class', foreground: '000000' }, // DEFAULT_CLASS_REFERENCE 未设
      { token: 'support.class', foreground: '000000' }, // DEFAULT_CLASS_REFERENCE 未设
      { token: 'variable.other.property', foreground: '871094', fontStyle: 'bold' }, // DEFAULT_INSTANCE_FIELD
      { token: 'variable.other', foreground: '2a8c7c' }, // JS.LOCAL_VARIABLE
      { token: 'variable.parameter', foreground: '000000' }, // JS.PARAMETER 未设
      { token: 'variable.language', foreground: '830091', fontStyle: 'bold italic' }, // JS.GLOBAL_VARIABLE
      { token: 'storage.type.class.jsdoc', foreground: '8c8c8c', fontStyle: 'italic' }, // DEFAULT_DOC_COMMENT_TAG 未设，跟注释
      { token: 'entity.name.type.instance.jsdoc', foreground: '8c8c8c', fontStyle: 'italic' }, // DEFAULT_DOC_MARKUP 未设，跟注释
      { token: 'variable.other.jsdoc', foreground: '3d3d3d', fontStyle: 'italic' }, // DEFAULT_DOC_COMMENT_TAG_VALUE
    ],
    colors: {
      // 编辑区底色取 Light 方案自己的 attributes.TEXT.BACKGROUND（#ffffff，界面对应 --app-bg-surface）；
      // 暗色那套方案写的是 #191a1c（对应 --app-bg-page）——两套在这点上不一样，别拿同一个界面令牌去套
      'editor.background': '#ffffff',
      // 未命中规则的文字用方案里的标识符色
      'editor.foreground': '#000000',
      'editorGutter.background': '#ffffff',
      'editor.lineHighlightBackground': '#f5f8fe',
      'editorLineNumber.foreground': '#aeb3c2',
      'editorLineNumber.activeForeground': '#080808',
      'editorIndentGuide.background1': '#ebecf0',
      'editor.selectionBackground': '#a6d2ff',
      'editorCursor.foreground': '#080808',
    },
  },
};
