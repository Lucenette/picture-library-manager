import { getScriptById } from '@/db/database';

const Module = require('module');

export interface ScriptResult {
  success: boolean;
  selectedFile?: string;
  error?: string;
}

/**
 * 从 DB 代码字符串加载脚本模块
 * 仅用 filePath 设置 require 路径，文件移动后仍可正常执行
 */
function loadModule(code: string): any {
  const m = new Module('');
  m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(code, '');
  return m.exports;
}

/**
 * 执行选图脚本
 */
export async function runScript(scriptId: number | null, groupDirPath: string): Promise<ScriptResult> {
  if (scriptId === null) return { success: false, error: '未选择脚本' };

  const script = await getScriptById(scriptId);
  if (!script) return { success: false, error: `脚本不存在 (id=${scriptId})` };

  let mod: any;
  try { mod = loadModule(script.code); }
  catch (e: any) { return { success: false, error: `脚本加载失败: ${e.message}` }; }

  const fn = mod['select-image'];
  if (typeof fn !== 'function') {
    return { success: false, error: '脚本未导出 select-image 函数' };
  }

  try {
    const result = fn(groupDirPath);
    if (!result || typeof result !== 'string') {
      return { success: false, error: '脚本返回值无效' };
    }
    return { success: true, selectedFile: result };
  } catch (e: any) {
    return { success: false, error: `脚本执行异常: ${e.message}` };
  }
}
