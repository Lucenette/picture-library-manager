/**
 * 检查 src 下的导出符号是否都有 JSDoc 说明。
 *
 * AGENTS.md 硬性规范 4 要求「导出的符号必须有说明」，这条检查把它变成可执行的：顶层 export
 * 声明的上方必须紧挨着一个 JSDoc 块。不解析 AST，只看顶层声明——它们占绝大多数。
 *
 * 零依赖，直接运行：node scripts/check-jsdoc.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'src');

/** 只认顶层导出声明：跳过 export default、export { ... } 与 export type { ... }。 */
const DECLARATION =
  /^export\s+(?!default\b)(?!type\s*\{)(?:declare\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*|\{)/;

/**
 * 递归收集目录下的 .ts 文件；跳过只描述类型的 .d.ts。
 * @param {string} absDir 绝对目录
 * @param {string[]} out 收集结果
 */
function walk(absDir, out) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === 'static') {
      continue;
    }
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
}

/**
 * 判断第 index 行之前是否紧挨着一个 JSDoc 块（允许中间有空行）。
 * @param {string[]} lines 文件各行
 * @param {number} index 声明所在行
 * @returns {boolean} 上方是否有 JSDoc
 */
function hasJsdocAbove(lines, index) {
  let cursor = index - 1;
  while (cursor >= 0 && lines[cursor].trim() === '') {
    cursor -= 1;
  }
  if (cursor < 0 || !lines[cursor].trimEnd().endsWith('*/')) {
    return false;
  }
  for (let scan = cursor; scan >= 0; scan -= 1) {
    if (lines[scan].trimStart().startsWith('/**')) {
      return true;
    }
    if (scan !== cursor && lines[scan].includes('*/')) {
      return false;
    }
  }
  return false;
}

/**
 * 找出所有缺 JSDoc 的顶层导出符号。
 * @param {Map<string, string>} sources 相对路径到文本
 * @returns {{ file: string, line: number, name: string }[]} 违规列表
 */
export function findMissingJsdoc(sources) {
  const violations = [];
  for (const [file, text] of sources) {
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      const match = DECLARATION.exec(line);
      if (match === null) {
        continue;
      }
      if (hasJsdocAbove(lines, index)) {
        continue;
      }
      const name = match[2] === '{' ? '(解构)' : match[2];
      violations.push({ file, line: index + 1, name });
    }
  }
  return violations;
}

/** 读入 src 下全部 .ts 实现文件，键是相对仓库根、以 / 分隔的路径。 */
function readSources() {
  const files = [];
  walk(SRC, files);
  const sources = new Map();
  for (const abs of files) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    sources.set(rel, readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n'));
  }
  return sources;
}

/** 命令行入口：逐条报出缺 JSDoc 的导出，有则退出码 1。 */
function main() {
  const found = findMissingJsdoc(readSources());
  for (const item of found) {
    console.log(`${item.file}:${item.line} 导出符号 ${item.name} 缺 JSDoc`);
  }
  if (found.length > 0) {
    console.log(`导出符号缺 JSDoc：${found.length} 条`);
    process.exitCode = 1;
    return;
  }
  console.log('导出符号 JSDoc 检查通过');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
