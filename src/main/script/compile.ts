// ============================================================
// 处理脚本的编译
//
// 脚本以 CommonJS 源码字符串存放在数据库中：录入时用它检测脚本导出了哪些
// 方法，执行时用它把源码编译成模块再取出方法。两处都在主进程，所以这个模块
// 也留在主进程的脚本目录里，不与渲染进程共享。
// ============================================================

/**
 * Node 的 Module 实例。
 *
 * `Module#_compile` 是 Node 的内部 API，@types/node 未公开，
 * 这里按实际用到的形状补一份声明。
 */
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
 * 编译本身会执行脚本的顶层代码；语法错误或顶层抛错都会原样抛出，
 * 由调用方决定如何提示。脚本的 `filePath` 为空串，因此相对的
 * `require` 只能解析到 `process.cwd()` 下的 `node_modules`。
 *
 * @param code 脚本源码
 * @returns 脚本导出的对象
 */
export function compileScriptModule(code: string): Record<string, unknown> {
  const scriptModule = new NodeModule('');
  scriptModule.paths = NodeModule._nodeModulePaths(process.cwd());
  scriptModule._compile(code, '');
  return scriptModule.exports as Record<string, unknown>;
}
