import type { ScriptType } from '@common/types';

import { getScriptById } from '@/database/db';
import { withScriptLogChannel } from '@/log';
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
    throw new Error(`script not found (id=${scriptId})`);
  }

  let code: string;
  try {
    code = await readScriptSource(script.filePath);
  } catch {
    throw new Error(`script file not found: ${script.filePath}`);
  }

  let scriptExports: Record<string, unknown>;
  try {
    scriptExports = compileScriptModule(code, script.filePath);
  } catch (error) {
    throw new Error(`failed to load script: ${(error as Error).message}`, { cause: error });
  }

  const handler = scriptExports[method];
  if (typeof handler !== 'function') {
    throw new Error(`script does not export method: ${method}`);
  }

  // 脚本执行期间它自己的 console.* 归到 script 通道（落 script.log 并进控制台）
  return withScriptLogChannel(() => (handler as (...handlerArgs: unknown[]) => T)(...args));
}
