/**
 * 检查常驻文档的字数预算。
 *
 * 预算写在 scripts/doc-budgets.json，单位是**非空白字符数**：本仓库的文档一段一行，
 * 行数会被长段落骗过去。常驻文档指每个会话都要读的那些——AGENTS.md、skill 正文、
 * 文档地图与贡献指引。
 *
 * 超预算不是改数字了事：先搬走属于别层的内容，再压缩留在本层的，最后才提额，
 * 并在提交信息里写明理由。见 AGENTS.md 的「改完必须自检」。
 *
 * 零依赖，直接运行：node scripts/check-doc-budgets.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const BUDGETS = resolve(ROOT, 'scripts', 'doc-budgets.json');

/**
 * 数一段文本里的非空白字符。
 * @param {string} text 文本
 * @returns {number} 非空白字符数
 */
export function countChars(text) {
  return text.replace(/\s+/gu, '').length;
}

/**
 * 逐条比对预算。
 * @param {Map<string, string>} texts 相对路径到文本
 * @param {Record<string, number>} budgets 相对路径到上限
 * @returns {{ file: string, current: number, budget: number, kind: 'missing' | 'over' }[]} 违规
 */
export function checkBudgets(texts, budgets) {
  const violations = [];
  for (const [file, budget] of Object.entries(budgets)) {
    const text = texts.get(file);
    if (text === undefined) {
      violations.push({ file, current: 0, budget, kind: 'missing' });
      continue;
    }
    const current = countChars(text);
    if (current > budget) {
      violations.push({ file, current, budget, kind: 'over' });
    }
  }
  return violations;
}

/** 读入预算清单里列到的文件。
 * @param {Record<string, number>} budgets 预算清单
 * @returns {Map<string, string>} 路径到文本
 */
function readBudgetedFiles(budgets) {
  const texts = new Map();
  for (const file of Object.keys(budgets)) {
    const abs = resolve(ROOT, file);
    if (existsSync(abs)) {
      texts.set(file, readFileSync(abs, 'utf8'));
    }
  }
  return texts;
}

/** 命令行入口：逐条报出超预算或缺失的文件。 */
function main() {
  const budgets = JSON.parse(readFileSync(BUDGETS, 'utf8'));
  const violations = checkBudgets(readBudgetedFiles(budgets), budgets);
  for (const item of violations) {
    if (item.kind === 'missing') {
      console.log(`${item.file} 列在 scripts/doc-budgets.json 里，但文件不存在`);
    } else {
      console.log(`${item.file} 超出预算：当前 ${item.current} 字，上限 ${item.budget} 字（超 ${item.current - item.budget}）`);
    }
  }
  if (violations.length > 0) {
    console.log(`文档预算检查不通过：${violations.length} 个文件`);
    process.exitCode = 1;
    return;
  }
  console.log(`文档预算检查通过：${Object.keys(budgets).length} 个常驻文档`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
