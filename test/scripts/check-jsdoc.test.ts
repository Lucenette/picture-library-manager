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

test('普通块注释不能隔空顶替更早的 JSDoc', () => {
  const text = ['/** 说明 A */', 'export const a = 1;', '/* 只是普通注释 */', 'export const b = 2;'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([{ file: 'src/a.ts', line: 4, name: 'b' }]);
});

test('块注释里的 export 不算导出', () => {
  const text = ['/*', 'export const y = 2;', '*/'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([]);
});

test('带 BOM 的文件首个导出仍能被识别', () => {
  const text = '\uFEFFexport const y = 2;\n';
  expect(findMissingJsdoc(sources(text))).toEqual([{ file: 'src/a.ts', line: 1, name: 'y' }]);
});

test('函数重载只要求第一处带 JSDoc', () => {
  const text = ['/** 说明 */', 'export function foo(a: string): void;', 'export function foo(a: number): void;', 'export function foo(a: any) {}'].join('\n');
  expect(findMissingJsdoc(sources(text))).toEqual([]);
});

test('const enum 报真正的符号名', () => {
  const text = 'export declare const enum E { A }\n';
  expect(findMissingJsdoc(sources(text)).map((item: { name: string }) => item.name)).toEqual(['E']);
});

test('行尾的块注释不清掉同一行的声明', () => {
  const text = 'export const t = 1; /* trailing */\n';
  expect(findMissingJsdoc(sources(text))).toEqual([{ file: 'src/a.ts', line: 1, name: 't' }]);
});
