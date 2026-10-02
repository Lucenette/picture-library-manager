/**
 * 代码规范静态检查。
 *
 * 检查四条硬性规范（见 AGENTS.md）：
 *   1. 禁止命名空间导入：import * as / export * / export * as；
 *   2. 控制语句必须带大括号（if / else / for / for-in / for-of / while / do-while）；
 *   3. 渲染进程不得引用 Node 内置模块（electron 按既有设计放行）；
 *   4. src/main/database/ 不得依赖 @/ups。
 *
 * 零新增依赖：只用仓库已有的 typescript 与 @vue/compiler-sfc。覆盖 .ts 与 .vue。
 * 用法：node scripts/check-code.mjs；通过时打印一行，发现问题逐条打印并以退出码 1 结束。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, resolve } from 'node:path';

import { parse as parseSfc } from '@vue/compiler-sfc';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** Node 内置模块名；比较前剥掉 node: 前缀 */
const BUILTINS = new Set(builtinModules);
/** 渲染进程按既有设计放行 electron（nodeIntegration + contextIsolation: false） */
const RENDERER_ALLOWED = new Set(['electron']);
/** 数据库模块的下层边界：不得反向依赖升级模块 */
const DATABASE_FORBIDDEN = /^@\/ups(?:\/|$)/;

const violations = [];

function report(file, line, message) {
  violations.push(file + ':' + line + ' ' + message);
}

/** 递归收集 src 下的 .ts 与 .vue */
function collectSources(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(full, out);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.vue'))) {
      out.push(full);
    }
  }
}

/** 相对仓库根、以 / 分隔的展示路径 */
function displayPath(absPath) {
  return relative(ROOT, absPath).replaceAll('\\', '/');
}

/** 对一段 TypeScript 源码跑四条规则；baseLine 是这段源码第一行在文件里的行号 */
function checkTree(rel, absPath, content, baseLine) {
  const source = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const isRenderer = rel.startsWith('src/renderer/');
  const isDatabase = rel.startsWith('src/main/database/');

  const lineOf = (node) => baseLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line;

  const checkSpecifier = (specifier, node) => {
    const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    if (isRenderer && BUILTINS.has(bare) && !RENDERER_ALLOWED.has(bare)) {
      report(rel, lineOf(node), '渲染进程不得引用 Node 内置模块：' + bare);
    }
    if (isDatabase && DATABASE_FORBIDDEN.test(specifier)) {
      report(rel, lineOf(node), 'src/main/database 不得依赖 @/ups');
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause !== undefined && node.importClause.namedBindings !== undefined && ts.isNamespaceImport(node.importClause.namedBindings)) {
      report(rel, lineOf(node), '禁止命名空间导入：import * as');
    }
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause === undefined) {
        report(rel, lineOf(node), '禁止命名空间导出：export *');
      } else if (ts.isNamespaceExport(node.exportClause)) {
        report(rel, lineOf(node), '禁止命名空间导出：export * as');
      }
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        checkSpecifier(node.moduleSpecifier.text, node);
      }
    }
    if (ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      checkSpecifier(node.moduleSpecifier.text, node);
    }
    if (ts.isIfStatement(node)) {
      if (node.thenStatement.kind !== ts.SyntaxKind.Block) {
        report(rel, lineOf(node), '控制语句必须带大括号：if');
      }
      if (node.elseStatement !== undefined && node.elseStatement.kind !== ts.SyntaxKind.Block && node.elseStatement.kind !== ts.SyntaxKind.IfStatement) {
        report(rel, lineOf(node), '控制语句必须带大括号：else');
      }
    } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      if (node.statement.kind !== ts.SyntaxKind.Block) {
        report(rel, lineOf(node), '控制语句必须带大括号：' + ts.SyntaxKind[node.kind]);
      }
    }
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
        checkSpecifier(node.arguments[0].text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function checkFile(absPath) {
  const rel = displayPath(absPath);
  if (absPath.endsWith('.vue')) {
    const content = readFileSync(absPath, 'utf8');
    const { descriptor, errors } = parseSfc(content, { filename: absPath });
    if (errors.length > 0) {
      report(rel, 1, 'SFC 解析失败：' + errors[0].message);
      return;
    }
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block === null || block === undefined) {
        continue;
      }
      const baseLine = content.slice(0, block.loc.start.offset).split('\n').length;
      checkTree(rel, absPath, block.content, baseLine);
    }
    return;
  }
  checkTree(rel, absPath, readFileSync(absPath, 'utf8'), 1);
}

const files = [];
collectSources(SRC, files);
files.sort();
for (const file of files) {
  checkFile(file);
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.log(violation);
  }
  console.log('代码规范检查失败：' + violations.length + ' 个问题。');
  process.exit(1);
}
console.log('代码规范检查通过：' + files.length + ' 个文件。');
