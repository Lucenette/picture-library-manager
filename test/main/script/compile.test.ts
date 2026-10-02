import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { detectScriptTypes, inspectScript } from '@/script/compile';

import { makeTempDir, removeTempDir, writeFiles } from '../../setup/temp-dir';

test('三个导出类型都认得出来', () => {
  const code = "module.exports = { 'select-image': () => 'u', 'identify-character': (n) => n, 'identify-structure': () => [] };";
  expect(detectScriptTypes(code)).toEqual(['select-image', 'identify-character', 'identify-structure']);
});

test('没有导出脚本方法时类型为空', () => {
  expect(detectScriptTypes('module.exports = {};')).toEqual([]);
});

test('语法错误时类型为空且带编译错误', () => {
  const result = inspectScript('module.exports = {', join(makeTempDir(), 'broken.js'));
  expect(result.types).toEqual([]);
  expect(result.compileError).not.toBeNull();
  expect(typeof result.compileError?.message).toBe('string');
});

test('顶层抛错时带编译错误', () => {
  const result = inspectScript('throw new Error("boom");');
  expect(result.types).toEqual([]);
  expect(result.compileError?.message).toContain('boom');
});

test('require 相对路径按脚本所在目录解析', () => {
  const dir = makeTempDir();
  try {
    writeFiles(dir, { 'helper.js': 'module.exports = { value: 42 };' });
    const main = join(dir, 'main.js');
    writeFileSync(main, "const h = require('./helper'); module.exports = { 'select-image': () => String(h.value) };");
    const code = readFileSync(main, 'utf8');
    expect(detectScriptTypes(code, main)).toEqual(['select-image']);
  } finally {
    removeTempDir(dir);
  }
});
