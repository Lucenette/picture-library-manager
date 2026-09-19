// ============================================================
// 处理脚本的共享编译入口
//
// 脚本以 CommonJS 源码字符串存放在数据库中，主进程（录入时检测导出类型）
// 与渲染进程（执行选图/识别逻辑）都需要把它编译成模块并取出导出对象。
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
