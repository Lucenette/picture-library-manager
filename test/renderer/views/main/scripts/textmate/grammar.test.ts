import { beforeAll, describe, expect, test } from 'vitest';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import onigWasmDataUrl from 'vscode-oniguruma/release/onig.wasm?url&inline';
import { parseRawGrammar, Registry, type IGrammar } from 'vscode-textmate';

import { decodeDataUrl, toLineTokens } from '@/views/main/scripts/textmate/adapter';
import grammarText from '@/views/main/scripts/textmate/javascript.tmLanguage.json?raw';

/** 真语法 + 真 wasm：这里验的是「语法文件确实能把行内与行间注释分成两个作用域」 */
const SCOPE_NAME = 'source.js';

let grammar: IGrammar;

beforeAll(async () => {
  // wasm 走与生产同一条路：Vite 内联的 data URL → 原始字节
  await loadWASM(decodeDataUrl(onigWasmDataUrl));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: (scopeName) => Promise.resolve(
      scopeName === SCOPE_NAME ? parseRawGrammar(grammarText, 'javascript.tmLanguage.json') : null,
    ),
  });
  const loaded = await registry.loadGrammar(SCOPE_NAME);
  if (loaded === null) {
    throw new Error('grammar not loaded: ' + SCOPE_NAME);
  }
  grammar = loaded;
});

/** 把一行分词后交给 Monaco 的作用域串都收出来 */
function scopesOf(line: string): string[] {
  return toLineTokens(grammar, line, null).tokens.map((token) => token.scopes);
}

/** 某个作用域族在不在这一行的结果里 */
function hasScope(scopes: string[], prefix: string): boolean {
  return scopes.some((scope) => scope === prefix || scope.startsWith(prefix + '.'));
}

describe('JavaScript TextMate 语法', () => {
  test('行内注释是 comment.line，行间注释是 comment.block', () => {
    expect(hasScope(scopesOf('// 行内注释'), 'comment.line')).toBe(true);
    expect(hasScope(scopesOf('/* 行间注释 */'), 'comment.block')).toBe(true);
    expect(hasScope(scopesOf('// 行内注释'), 'comment.block')).toBe(false);
  });

  test('关键字、字符串、数字落在可配色的大类里', () => {
    const scopes = scopesOf('const name = "demo"; const count = 42;');
    expect(hasScope(scopes, 'storage.type')).toBe(true);
    expect(hasScope(scopes, 'string.quoted')).toBe(true);
    expect(hasScope(scopes, 'constant.numeric')).toBe(true);
  });

  test('交回 Monaco 的是一段段不带空格的作用域串', () => {
    for (const scope of scopesOf('function run(flag) { return flag ? 1 : 0; }')) {
      expect(scope).not.toContain(' ');
    }
  });
});
