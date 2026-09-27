import type { ScriptType } from '@common/types';

import { getScriptById } from '@/database/db';
import { compileScriptModule } from '@/script/compile';
import { readScriptSource } from '@/script/files';

/**
 * 在主进程中执行处理脚本的方法。
 *
 * 正文在磁盘上，所以**每次调用都重新读文件并编译**：运行期间改了脚本，下一次调用就生效；
 * 模块级状态不跨调用保留（这是既有语义，改了要同步 `docs/SCRIPTING.md`）。
 * 读盘那一层按 path + mtime + size 缓存，任务里每个图片组都调一次也不会反复读盘。
 *
 * @param scriptId 脚本 id
 * @param method 要调用的导出方法名
 * @param args 传给方法的参数
 * @returns 脚本方法的返回值
 * @throws 脚本不存在、文件读不到、编译失败、未导出该方法或方法自身抛出时
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

  let code: string;
  try {
    code = await readScriptSource(script.filePath);
  } catch {
    throw new Error(`脚本文件不存在：${script.filePath}`);
  }

  let scriptExports: Record<string, unknown>;
  try {
    scriptExports = compileScriptModule(code, script.filePath);
  } catch (error) {
    throw new Error(`脚本加载失败：${(error as Error).message}`);
  }

  const handler = scriptExports[method];
  if (typeof handler !== 'function') {
    throw new Error(`脚本未导出方法：${method}`);
  }

  return (handler as (...handlerArgs: unknown[]) => T)(...args);
}
