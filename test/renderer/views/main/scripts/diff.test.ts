import { test, expect } from 'vitest';

import { diffLineChanges } from '@/views/main/scripts/diff';

test('没有变化时返回空', () => {
  expect(diffLineChanges('a\nb', 'a\nb')).toEqual([]);
});

test('纯新增只报新增区间', () => {
  expect(diffLineChanges('a\nb', 'a\nx\nb')).toEqual([
    { startLineNumber: 2, endLineNumber: 2, kind: 'added' },
  ]);
});

test('纯删除记删除处开始的行', () => {
  expect(diffLineChanges('a\nx\nb', 'a\nb')).toEqual([
    { startLineNumber: 2, endLineNumber: 2, kind: 'deleted' },
  ]);
});

test('单行改动算 modified', () => {
  expect(diffLineChanges('a\nb\nc', 'a\nB\nc')).toEqual([
    { startLineNumber: 2, endLineNumber: 2, kind: 'modified' },
  ]);
});

test('整篇重写走快速通道，算一整段 modified', () => {
  expect(diffLineChanges('a\nb', 'x\ny')).toEqual([
    { startLineNumber: 1, endLineNumber: 2, kind: 'modified' },
  ]);
});

test('删在末尾时退回最后一行', () => {
  expect(diffLineChanges('a\nb', 'a')).toEqual([
    { startLineNumber: 1, endLineNumber: 1, kind: 'deleted' },
  ]);
});

test('末尾补一个换行算新增一行', () => {
  expect(diffLineChanges('a', 'a\n')).toEqual([
    { startLineNumber: 2, endLineNumber: 2, kind: 'added' },
  ]);
});
