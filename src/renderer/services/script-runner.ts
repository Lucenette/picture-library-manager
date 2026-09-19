import { compileScriptModule } from '@common/script';
import type { ScriptType } from '@common/types';
import { getScriptById } from '@/db/database';

/**
 * 执行处理脚本中导出的指定方法。
 *
 * 脚本每次调用都重新编译，因此改动源码后无需重启应用。
 *
 * @param scriptId 脚本 id
 * @param method 要调用的导出方法名
 * @param args 传给方法的参数
 * @returns 脚本方法的返回值
 * @throws 脚本不存在、编译失败、未导出该方法或方法自身抛出时
 */
export async function executeScript<T = unknown>(
  scriptId: number,
  method: ScriptType,
  ...args: unknown[]
): Promise<T> {
  const script = await getScriptById(scriptId);
  if (!script) {
    throw new Error(`脚本不存在（id=${scriptId}）`);
  }

  let scriptExports: Record<string, unknown>;
  try {
    scriptExports = compileScriptModule(script.code);
  } catch (error) {
    throw new Error(`脚本加载失败：${(error as Error).message}`);
  }

  const handler = scriptExports[method];
  if (typeof handler !== 'function') {
    throw new Error(`脚本未导出方法：${method}`);
  }

  return (handler as (...handlerArgs: unknown[]) => T)(...args);
}
