/**
 * 检查 src 下的导出符号是否都有 JSDoc 说明。
 *
 * AGENTS.md 硬性规范 4 要求「导出的符号必须有说明」，这条检查把它变成可执行的：顶层 export
 * 声明的上方必须紧挨着一个 JSDoc 块。不解析 AST，只看顶层声明——它们占绝大多数。
 *
 * 匹配前先把注释从每行里剔除，避免两条相反的错：块注释里的 \`export ...\` 被当成真导出；
 * 一条普通块注释把更早的 JSDoc「隔空」顶给后面的导出。重载按名字去重，只要求第一处带 JSDoc。
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
  /^export\s+(?!default\b)(?!type\s*\{)(?:declare\s+)?(?:async\s+)?(function|abstract\s+class|const\s+enum|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*|\{)/;

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
 * 把每行里的注释内容替换成空格，并记录块注释的分布。
 *
 * 替换而不是删除：保持 \`export\` 仍在行首，正则才能照常匹配。字符串里的 \`/*\` 不处理——
 * 顶层导出声明不会写进字符串。
 * @param {string[]} lines 文件各行
 * @returns {{ code: string[], blockOf: number[], blocks: { start: number, end: number, jsdoc: boolean }[] }} 掩码行与块注释分布
 */
function stripComments(lines) {
  const code = [];
  const blockOf = new Array(lines.length).fill(-1);
  const blocks = [];
  let open = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let out = '';
    let pos = 0;
    while (pos < line.length) {
      if (open < 0) {
        const blockStart = line.indexOf('/*', pos);
        const lineStart = line.indexOf('//', pos);
        if (lineStart >= 0 && (blockStart < 0 || lineStart < blockStart)) {
          out += line.slice(pos, lineStart);
          break;
        }
        if (blockStart < 0) {
          out += line.slice(pos);
          break;
        }
        out += line.slice(pos, blockStart);
        open = blocks.length;
        blocks.push({ start: index, end: index, jsdoc: line.startsWith('/**', blockStart) });
        if (blockOf[index] < 0) {
          blockOf[index] = open;
        }
        pos = blockStart + 2;
      } else {
        if (blockOf[index] < 0) {
          blockOf[index] = open;
        }
        const close = line.indexOf('*/', pos);
        if (close < 0) {
          out += ' '.repeat(line.length - pos);
          break;
        }
        out += ' '.repeat(close + 2 - pos);
        blocks[open].end = index;
        open = -1;
        pos = close + 2;
      }
    }
    code.push(out);
  }
  return { code, blockOf, blocks };
}

/**
 * 判断第 index 行之前是否紧挨着一个 JSDoc 块（允许中间有空行）。
 * @param {string[]} lines 文件各行
 * @param {number} index 声明所在行
 * @param {number[]} blockOf 每行所属块注释的下标
 * @param {{ jsdoc: boolean }[]} blocks 块注释
 * @returns {boolean} 上方是否有 JSDoc
 */
function hasJsdocAbove(lines, index, blockOf, blocks) {
  let cursor = index - 1;
  while (cursor >= 0 && lines[cursor].trim() === '') {
    cursor -= 1;
  }
  if (cursor < 0) {
    return false;
  }
  const block = blockOf[cursor];
  return block >= 0 && blocks[block].jsdoc;
}

/**
 * 找出所有缺 JSDoc 的顶层导出符号。
 * @param {Map<string, string>} sources 相对路径到文本
 * @returns {{ file: string, line: number, name: string }[]} 违规列表
 */
export function findMissingJsdoc(sources) {
  const violations = [];
  for (const [file, text] of sources) {
    const lines = text.replace(/^\uFEFF/, '').split('\n');
    const { code, blockOf, blocks } = stripComments(lines);
    const seen = new Set();
    for (const [index, line] of code.entries()) {
      const match = DECLARATION.exec(line);
      if (match === null) {
        continue;
      }
      const name = match[2] === '{' ? '(解构)' : match[2];
      // 重载：同名声明只要求第一处带 JSDoc
      if (match[2] !== '{') {
        if (seen.has(name)) {
          continue;
        }
        seen.add(name);
      }
      if (hasJsdocAbove(lines, index, blockOf, blocks)) {
        continue;
      }
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
