import { test, expect } from 'vitest';

import { checkBudgets, countChars } from '@scripts/check-doc-budgets.mjs';

test('非空白字符数不计空白', () => {
  expect(countChars('a b\nc\td')).toBe(4);
});

test('在预算内不报', () => {
  expect(checkBudgets(new Map([['AGENTS.md', 'abc']]), { 'AGENTS.md': 3 })).toEqual([]);
});

test('超预算报出当前值与上限', () => {
  expect(checkBudgets(new Map([['AGENTS.md', 'abcd']]), { 'AGENTS.md': 3 })).toEqual([
    { file: 'AGENTS.md', current: 4, budget: 3, kind: 'over' },
  ]);
});

test('清单里的文件不存在时报 missing', () => {
  expect(checkBudgets(new Map(), { 'docs/x.md': 10 })).toEqual([
    { file: 'docs/x.md', current: 0, budget: 10, kind: 'missing' },
  ]);
});

test('空文本在预算为 0 时不算超', () => {
  expect(checkBudgets(new Map([['a.md', '   \n\t']]), { 'a.md': 0 })).toEqual([]);
});
