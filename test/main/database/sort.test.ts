import { test, expect } from 'vitest';

import { CHARACTER_NAME_PROFILE, sortKeyOf } from '@/database/sort';

test('汉字归 3| 组，正文是拼音', () => {
  const key = sortKeyOf('阿波尼亚');
  expect(key.startsWith('3|')).toBe(true);
  expect(key).toContain('a bo ni ya');
});

test('数字按自然序：img2 在 img10 之前', () => {
  expect(sortKeyOf('img2') < sortKeyOf('img10')).toBe(true);
});

test('拉丁归 4| 组并转小写', () => {
  const key = sortKeyOf('Alice');
  expect(key.startsWith('4|')).toBe(true);
  expect(key).toContain('alice');
});

test('空名字与空白归 0| 组', () => {
  expect(sortKeyOf('')).toBe('0|');
  expect(sortKeyOf('   ')).toBe('0|');
});

test('混合名逐段处理：数字零填充、汉字转拼音', () => {
  const key = sortKeyOf('第2章');
  expect(key.startsWith('3|')).toBe(true);
  expect(key).toContain('0000000002');
  expect(key).toContain('zhang');
});

test('姓氏策略改变汉字读音', () => {
  const normal = sortKeyOf('单田芳');
  const surname = sortKeyOf('单田芳', CHARACTER_NAME_PROFILE);
  expect(normal).toContain('dan');
  expect(surname).toContain('shan');
});

test('同一输入两次结果一致（键是派生数据）', () => {
  expect(sortKeyOf('阿波尼亚')).toBe(sortKeyOf('阿波尼亚'));
});
