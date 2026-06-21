import { getScriptById, getImageFilesByGroup, getScriptsByType } from '@/db/database';
import type { ImageFile } from '@common/types';

const Module = require('module');
const crypto = require('crypto');

export interface ScriptResult {
  success: boolean;
  selectedFile?: string;
  error?: string;
}

export interface ScriptFileInfo {
  uuid: string;
  fileName: string;
  filePath: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  ext: string;
}

/**
 * 运行角色识别脚本，指定 ID 或自动取第一个
 */
export async function runIdentifyCharacter(dirName: string, scriptId?: number): Promise<string> {
  let script;
  if (scriptId) {
    script = await getScriptById(scriptId);
  } else {
    const scripts = await getScriptsByType('identify-character');
    script = scripts[0];
  }
  if (!script) return dirName;

  let mod: any;
  try { mod = loadModule(script.code); }
  catch { return dirName; }

  const fn = mod['identify-character'];
  if (typeof fn !== 'function') return dirName;

  try { return fn(dirName); }
  catch { return dirName; }
}

function loadModule(code: string): any {
  const m = new Module('');
  m.paths = Module._nodeModulePaths(process.cwd());
  m._compile(code, '');
  return m.exports;
}

/**
 * 执行选图脚本
 * 先查 DB 获取文件列表，生成临时 UUID，脚本基于元数据选图，返回目标 UUID
 */
export async function runScript(
  scriptId: number,
  characterName: string,
  groupDirPath: string,
  imageGroupId: number,
): Promise<ScriptResult> {
  const script = await getScriptById(scriptId);
  if (!script) return { success: false, error: `脚本不存在 (id=${scriptId})` };

  const files: ImageFile[] = await getImageFilesByGroup(imageGroupId);
  const uuidMap = new Map<string, string>();

  const scriptFiles: ScriptFileInfo[] = files.map(f => {
    const uuid = crypto.randomUUID();
    uuidMap.set(uuid, f.filePath);
    return {
      uuid,
      fileName: f.fileName,
      filePath: f.filePath,
      width: f.width,
      height: f.height,
      fileSize: f.fileSize || 0,
      ext: f.extension,
    };
  });

  let mod: any;
  try { mod = loadModule(script.code); }
  catch (e: any) { return { success: false, error: `脚本加载失败: ${e.message}` }; }

  const fn = mod['select-image'];
  if (typeof fn !== 'function') {
    return { success: false, error: '脚本未导出 select-image 函数' };
  }

  try {
    const resultUuid = fn({
      characterName,
      groupDirPath,
      files: scriptFiles,
    });

    if (!resultUuid || typeof resultUuid !== 'string') {
      return { success: false, error: '脚本返回值无效 (期望 uuid 字符串)' };
    }

    const selectedFile = uuidMap.get(resultUuid);
    if (!selectedFile) {
      return { success: false, error: `脚本返回了未知 uuid: ${resultUuid}` };
    }

    return { success: true, selectedFile };
  } catch (e: any) {
    return { success: false, error: `脚本执行异常: ${e.message}` };
  }
}
