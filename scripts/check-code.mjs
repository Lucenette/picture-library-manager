/**
 * 代码规范静态检查。
 *
 * 检查硬性规范与「改完必须自检」里的静态项（见 AGENTS.md）：
 *   1. 禁止命名空间导入：import * as / export * / export * as；
 *   2. 控制语句必须带大括号（if / else / for / for-in / for-of / while / do-while）；
 *   3. 渲染进程不得引用 Node 内置模块（electron 按既有设计放行）；
 *   4. src/main/database/ 不得依赖 @/ups；
 *   5. .vue 的 script setup 与模板能编译通过；
 *   6. @/、@common/、@static/ 与相对路径的导入能落到真实文件（?nodeWorker 虚拟模块除外）。
 *
 * 零新增依赖：只用仓库已有的 typescript 与 @vue/compiler-sfc。覆盖 .ts 与 .vue。
 * 用法：node scripts/check-code.mjs；通过时打印一行，发现问题逐条打印并以退出码 1 结束。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileScript, compileTemplate, parse as parseSfc } from '@vue/compiler-sfc';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');
/** 参与扫描的根：源码与测试都守同一套硬性规范 */
const SCAN_ROOTS = [join(ROOT, 'src'), join(ROOT, 'test')];

/** Node 内置模块名；比较前剥掉 node: 前缀 */
const BUILTINS = new Set(builtinModules);
/** 渲染进程按既有设计放行 electron（nodeIntegration + contextIsolation: false） */
const RENDERER_ALLOWED = new Set(['electron']);
/** 数据库模块的下层边界：不得反向依赖升级模块 */
const DATABASE_FORBIDDEN = /^@\/ups(?:\/|$)/;
/** 解析导入时依次尝试的后缀，对齐 Vite 的解析 */
const IMPORT_SUFFIXES = ['', '.ts', '.tsx', '.vue', '.d.ts', '.js', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.vue'];

/** 基础路径能否落到一个真实文件 */
function resolvesToFile(basePath) {
  for (const suffix of IMPORT_SUFFIXES) {
    const candidate = basePath + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return true;
    }
  }
  return false;
}

const violations = [];
/** 当前收集问题的地方；lintText 会临时换成自己的小数组 */
let sink = violations;

function report(file, line, message) {
  sink.push(file + ':' + line + ' ' + message);
}

/**
 * 对一段源码跑全部规则，返回问题列表。
 *
 * 测试不必起子进程扫全仓库，直接喂一段内容就能验规则。
 */
export function lintText(rel, content) {
  const local = [];
  const previous = sink;
  sink = local;
  try {
    const absPath = join(ROOT, rel);
    if (rel.endsWith('.vue')) {
      checkVue(rel, absPath, content);
    } else {
      checkTree(rel, absPath, content, 1);
    }
  } finally {
    sink = previous;
  }
  return local;
}

/** 递归收集 src 下的 .ts 与 .vue */
function collectSources(dir, out) {
  if (!existsSync(dir)) {
    return;
  }
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
  const isRenderer = rel.startsWith('src/renderer/') || rel.startsWith('test/renderer/');
  const isDatabase = rel.startsWith('src/main/database/');

  const lineOf = (node) => baseLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line;

  const aliasRoot = isRenderer ? join(ROOT, 'src/renderer') : join(ROOT, 'src/main');

  /** 只查仓库内可解析的导入；裸包名与 ?nodeWorker 虚拟模块放行 */
  const checkResolvable = (specifier, node) => {
    if (specifier.endsWith('?nodeWorker')) {
      return;
    }
    const clean = specifier.replace(/\?.*$/, '');
    let basePath = null;
    if (clean.startsWith('@/')) {
      basePath = join(aliasRoot, clean.slice(2));
    } else if (clean.startsWith('@common/')) {
      basePath = join(ROOT, 'src/common', clean.slice(8));
    } else if (clean.startsWith('@static/')) {
      basePath = join(ROOT, 'src/static', clean.slice(8));
    } else if (clean.startsWith('./') || clean.startsWith('../')) {
      basePath = resolve(dirname(absPath), clean);
    }
    if (basePath !== null && !resolvesToFile(basePath)) {
      report(rel, lineOf(node), '导入无法解析：' + specifier);
    }
  };

  const checkSpecifier = (specifier, node) => {
    checkResolvable(specifier, node);
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

/** .vue 的规则：SFC 解析、script / script setup 与模板编译，外加脚本块的四条规则 */
function checkVue(rel, absPath, content) {
  {
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
    if (descriptor.scriptSetup !== null && descriptor.scriptSetup !== undefined) {
      try {
        compileScript(descriptor, { id: absPath });
      } catch (error) {
        report(rel, 1, 'script setup 编译失败：' + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (descriptor.template !== null && descriptor.template !== undefined) {
      const result = compileTemplate({ source: descriptor.template.content, filename: absPath, id: absPath });
      for (const error of result.errors) {
        const message = typeof error === 'string' ? error : error.message;
        const offset = typeof error === 'string' ? 0 : ((error.loc && error.loc.start.line) || 1) - 1;
        report(rel, descriptor.template.loc.start.line + offset, '模板编译失败：' + message);
      }
    }
  }
}

function checkFile(absPath) {
  violations.push(...lintText(displayPath(absPath), readFileSync(absPath, 'utf8')));
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    collectSources(root, files);
  }
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
}

/** 只有直接运行这个脚本时才扫全仓库；被测试 import 时只提供 lintText */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
