// ============================================================
// 处理脚本的编译与检查
//
// 脚本以 CommonJS 源码存在磁盘上（用户目录的 `scripts/` 下）：检测导出了什么、执行它，
// 都要先把它编译成模块。两处都在主进程，所以这个模块留在主进程的脚本目录里，不与渲染进程共享。
// ============================================================

import type { ScriptCompileError, ScriptType } from '@common/types';

/** 脚本类型全集：检测导出了哪些方法时按它过滤 */
const ALL_SCRIPT_TYPES: ScriptType[] = ['select-image', 'identify-character', 'identify-structure'];

/** Node 的 Module 实例；@types/node 没公开 _compile，按用到的形状补一份 */
interface CompilableModule extends NodeJS.Module {
  _compile(code: string, filename: string): void;
}

/** Node 的 Module 构造器（含内部静态方法） */
interface ModuleConstructor {
  new (id: string, parent?: NodeJS.Module): CompilableModule;
  _nodeModulePaths(from: string): string[];
}

const NodeModule = require('module') as ModuleConstructor;

/**
 * 编译一段处理脚本源码，返回其 `module.exports`。
 *
 * 编译本身会执行脚本的顶层代码；语法错误或顶层抛错都会原样抛出，由调用方决定如何提示。
 *
 * @param code 脚本源码
 * @param filename 脚本文件路径；传了它，堆栈与 `require('./x')` 都指向真实文件
 */
export function compileScriptModule(code: string, filename = ''): Record<string, unknown> {
  // 直接调 _compile 不经过 Module.load，id 与 filename 得自己设：Node 的 CJS 解析器
  // 用 module.id 定位相对引用的基准目录，传空串会让 require('./x') 退化成从 cwd 找。
  const scriptModule = new NodeModule(filename);
  scriptModule.filename = filename;
  scriptModule.paths = NodeModule._nodeModulePaths(process.cwd());
  scriptModule._compile(code, filename);
  return scriptModule.exports as Record<string, unknown>;
}

/**
 * 编译一份脚本并报告结果：导出了哪些方法，以及编译失败的原因。
 *
 * 两者只会有一个非空：编译不过时 types 为空、compileError 有值（错误必须被看见，不能静默当没导出）。
 */
export function inspectScript(
  code: string,
  filename = '',
): { types: ScriptType[]; compileError: ScriptCompileError | null } {
  try {
    const scriptExports = compileScriptModule(code, filename);
    return {
      types: ALL_SCRIPT_TYPES.filter((type) => typeof scriptExports[type] === 'function'),
      compileError: null,
    };
  } catch (error) {
    return { types: [], compileError: describeCompileError(error) };
  }
}

/** 只关心「导出了哪些方法」时的简写 */
export function detectScriptTypes(code: string, filename = ''): ScriptType[] {
  return inspectScript(code, filename).types;
}

/**
 * 把编译或运行期的异常变成「消息 + 行列」，供编辑器的行内标记与问题面板用。
 *
 * 语法错误的 `stack` 首行是 `<路径>:<行号>`、第三行是插入符；顶层抛错的堆栈里带
 * `(<路径>:<行>:<列>)`。都取不到就只给消息，行列留 null——界面退回第一行标记，
 * 至少让人看见有错，而不是静默当它没问题。
 */
export function describeCompileError(error: unknown): ScriptCompileError {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const lines = stack.split('\n');

  const syntax = /:(\d+)$/.exec(lines[0] ?? '');
  if (error instanceof SyntaxError && syntax !== null) {
    const caret = (lines[2] ?? '').indexOf('^');
    return { message, line: Number(syntax[1]), column: caret >= 0 ? caret + 1 : null };
  }

  const thrown = /\(([^()]*):(\d+):(\d+)\)/.exec(stack);
  if (thrown !== null) {
    return { message, line: Number(thrown[2]), column: Number(thrown[3]) };
  }

  return { message, line: null, column: null };
}
