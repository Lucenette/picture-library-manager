import { getScriptById } from '@/db/database';
import type { ProcessScript } from '@/types';

/**
 * 脚本执行服务
 *
 * 每个脚本是一个 .js 文件，必须 CommonJS 格式导出默认函数：
 *   module.exports = function(groupDirPath: string): string
 *
 * 执行方式：直接 require() 脚本文件，无沙箱，脚本拥有完整 Node 权限。
 * 每次执行前清除 require.cache 确保拿到最新代码。
 */

/** 脚本执行结果 */
export interface ScriptResult {
  success: boolean;
  selectedFile?: string;
  error?: string;
}

/**
 * 执行处理脚本
 */
export async function runScript(scriptId: number | null, groupDirPath: string): Promise<ScriptResult> {
  if (scriptId === null) {
    return { success: false, error: '未选择脚本' };
  }

  const script: ProcessScript | undefined = await getScriptById(scriptId);
  if (!script) {
    return { success: false, error: `脚本不存在 (id=${scriptId})` };
  }

  // 清除缓存，确保拿到磁盘上最新版本
  const resolved = require.resolve(script.filePath);
  delete require.cache[resolved];

  let scriptFn: (groupDirPath: string) => string;
  try {
    scriptFn = require(script.filePath);
  } catch (e: any) {
    return { success: false, error: `脚本加载失败: ${e.message}` };
  }

  if (typeof scriptFn !== 'function') {
    return { success: false, error: `脚本未导出函数 (module.exports 应为 function，实际为 ${typeof scriptFn})` };
  }

  let selectedFile: string;
  try {
    selectedFile = scriptFn(groupDirPath);
  } catch (e: any) {
    return { success: false, error: `脚本执行异常: ${e.message}` };
  }

  if (!selectedFile || typeof selectedFile !== 'string') {
    return { success: false, error: `脚本返回值无效 (期望 string，实际为 ${typeof selectedFile})` };
  }

  return { success: true, selectedFile };
}
