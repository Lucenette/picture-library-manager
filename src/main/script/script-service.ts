import { compileScriptModule } from '@/script/compile';
import type { ScriptType } from '@common/types';
import { getScriptById } from '@/database/db';

/**
 * 在主进程中执行处理脚本的方法。
 *
 * 扫描与批量选图都已搬到主进程，脚本也一并在这里执行，省掉了每次调用
 * 一次 IPC 往返的开销。
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
  const script = getScriptById(scriptId);
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
