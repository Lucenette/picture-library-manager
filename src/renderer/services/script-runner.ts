import { getScriptById } from '@/db/database';

const Module = require('module');

function loadModule(code: string): any {
  const m = new Module('');
  m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(code, '');
  return m.exports;
}

/**
 * 通用脚本执行器
 *
 * @param scriptId 脚本 ID
 * @param method   要调用的导出方法名（如 'select-image'）
 * @param args     传给方法的参数
 * @returns 方法返回值，失败抛错
 */
export async function executeScript(scriptId: number, method: string, ...args: any[]): Promise<any> {
  const script = await getScriptById(scriptId);
  if (!script) throw new Error(`脚本不存在 (id=${scriptId})`);

  let mod: any;
  try { mod = loadModule(script.code); }
  catch (e: any) { throw new Error(`脚本加载失败: ${e.message}`); }

  const fn = mod[method];
  if (typeof fn !== 'function') throw new Error(`脚本未导出方法: ${method}`);

  return fn(...args);
}
