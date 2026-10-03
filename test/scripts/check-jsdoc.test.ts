import { test, expect } from 'vitest';

import { findMissingJsdoc } from '@scripts/check-jsdoc.mjs';

/** 把源码文本包成单文件 sources。
 * @param {string} text 源码
 * @returns {Map<string, string>} sources
 */
function sources(text: string): Map<string, string> {
  return new Map([['src/a.ts', text]]);
}

test('有 JSDoc 的导出不报', () => {
  const text = ['/** 说明 */', 'export function foo(): void {}'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([]);
});

test('缺 JSDoc 的导出报出行号与符号名', () => {
  const text = ['const x = 1;', '', 'export const y = 2;'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([{ file: 'src/a.ts', line: 3, name: 'y' }]);
});

test('export default / export { } / export type { } 不算导出符号', () => {
  const text = ['export default function () {}', "export { a } from './a';", "export type { B } from './b';"].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([]);
});

test('JSDoc 与声明之间有空行仍然算数', () => {
  const text = ['/** 说明 */', '', 'export interface Foo {}'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([]);
});

test('行注释不算 JSDoc', () => {
  const text = ['// 说明', 'export interface Foo {}'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([{ file: 'src/a.ts', line: 2, name: 'Foo' }]);
});

test('每种顶层声明都认', () => {
  const text = ['export class A {}', 'export interface B {}', 'export type C = string;', 'export enum D {}'].join('\n');
  expect(findMissingJsdoc(sources(text)).map((item: { name: string }) => item.name)).toEqual(['A', 'B', 'C', 'D']);
});
