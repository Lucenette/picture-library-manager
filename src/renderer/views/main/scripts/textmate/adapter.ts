// ============================================================
// TextMate 与 Monaco 之间的纯适配层
//
// 这里只翻译数据形状：不碰 wasm、不引 Monaco 运行时（下面两个接口是 Monaco 协议的结构等价物），
// 所以能在没有浏览器、没有 Electron 的测试里直接驱动。
// ============================================================

import type { StateStack } from 'vscode-textmate';

/** Monaco 的 token 只要求这两个字段（见 monaco.d.ts 的 IToken） */
export interface MonacoToken {
  startIndex: number;
  scopes: string;
}

/**
 * Monaco 的逐行分词状态协议（等价于 monaco.d.ts 的 IState）。
 *
 * 自己声明一份是为了让本模块不依赖 monaco-editor：模型会克隆上一行的状态、并比较首尾状态，
 * 所以这两个方法缺一不可（`TokenizationSupportAdapter.adaptTokenize` 会调 `endState.equals(state)`）。
 */
export interface MonacoState {
  clone(): MonacoState;
  equals(other: unknown): boolean;
}

/**
 * 逐行分词需要的最小接口。
 *
 * `vscode-textmate` 的 `IGrammar` 天然满足它；测试里给一个假实现就能把适配逻辑跑起来。
 */
export interface LineTokenizer {
  tokenizeLine(
    line: string,
    prevState: StateStack | null,
  ): { tokens: { startIndex: number; scopes: string[] }[]; ruleStack: StateStack };
}

/** Monaco 的逐行分词状态：内里就是 TextMate 的规则栈 */
export class TokenizerState implements MonacoState {
  constructor(readonly stack: StateStack) {}

  clone(): TokenizerState {
    return new TokenizerState(this.stack);
  }

  equals(other: unknown): boolean {
    return other instanceof TokenizerState && this.stack.equals(other.stack);
  }
}

/**
 * 把一行 TextMate 分词结果翻成 Monaco 的 token 列表。
 *
 * `scopes` 只取最具体的那一段：Monaco 的主题是一棵按 `.` 分段的 trie
 * （见 `themeTrieElement.match`），喂给它空格分隔的完整作用域列表，它一段都对不上。
 */
export function toLineTokens(
  tokenizer: LineTokenizer,
  line: string,
  prevStack: StateStack | null,
): { tokens: MonacoToken[]; stack: StateStack } {
  const result = tokenizer.tokenizeLine(line, prevStack);
  const tokens: MonacoToken[] = result.tokens.map((token) => ({
    startIndex: token.startIndex,
    scopes: token.scopes[token.scopes.length - 1] ?? '',
  }));
  return { tokens, stack: result.ruleStack };
}

/**
 * 把 Vite `?url&inline` 内联出来的 data URL 解回原始字节。
 *
 * 打包后渲染进程是 `file://` 页面、`webSecurity` 又是开着的，运行时取不到本地 wasm；
 * 所以 wasm 以 base64 内联进产物，在这里解回来交给 `loadWASM`。
 */
export function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) {
    throw new Error('wasm asset is not a data url');
  }
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
