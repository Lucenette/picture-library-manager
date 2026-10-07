import { describe, expect, test } from 'vitest';
import type { StateStack } from 'vscode-textmate';

import { decodeDataUrl, toLineTokens, TokenizerState } from '@/views/main/scripts/textmate/adapter';

/** 假规则栈：StateStack 里我们真的用到的只有 equals，按对象身份比较即可 */
function fakeStack(): StateStack {
  const stack = {
    equals: (other: StateStack) => other === stack,
  } as unknown as StateStack;
  return stack;
}

/** 只回固定结果的假分词器：用它在没有 wasm、没有真语法的情况下驱动适配层 */
function fakeTokenizer(
  tokens: { startIndex: number; scopes: string[] }[],
  ruleStack: StateStack,
): { tokenizeLine(): { tokens: { startIndex: number; scopes: string[] }[]; ruleStack: StateStack } } {
  return {
    tokenizeLine: () => ({ tokens, ruleStack }),
  };
}

describe('toLineTokens', () => {
  test('每个 token 只带最具体的那一段作用域，startIndex 原样保留', () => {
    const stack = fakeStack();
    const tokenizer = fakeTokenizer(
      [
        { startIndex: 0, scopes: ['source.js', 'comment.line.double-slash.js'] },
        { startIndex: 8, scopes: [] },
      ],
      stack,
    );

    const result = toLineTokens(tokenizer, '// x', null);

    expect(result.tokens).toEqual([
      { startIndex: 0, scopes: 'comment.line.double-slash.js' },
      { startIndex: 8, scopes: '' },
    ]);
    expect(result.stack).toBe(stack);
  });
});

describe('TokenizerState', () => {
  test('clone 出同栈的新对象，equals 只认自己的同类与同一个规则栈', () => {
    const state = new TokenizerState(fakeStack());
    const other = new TokenizerState(fakeStack());

    expect(state.clone()).not.toBe(state);
    expect(state.clone().equals(state)).toBe(true);
    expect(state.equals(other)).toBe(false);
    expect(state.equals({ clone: () => state, equals: () => true })).toBe(false);
  });
});

describe('decodeDataUrl', () => {
  test('把 base64 data URL 解回原始字节', () => {
    // "hi" 的 base64 是 aGk=
    expect(Array.from(decodeDataUrl('data:application/wasm;base64,aGk='))).toEqual([0x68, 0x69]);
  });

  test('不是 data URL 就报错，不静默给一段空字节', () => {
    expect(() => decodeDataUrl('https://example.com/onig.wasm')).toThrow();
  });
});
