// ============================================================
// 脚本子系统：把「库里的行」与「用户目录里的文件」编在一起
//
// database 只出行，script/files 只出文件，两边在这里合流：读一个脚本要同时给出磁盘上的
// 正文与它自己的草稿，保存要「写文件 + 建行 + 检测类型」一起做。
// ============================================================

import { basename } from 'path';

import type {
  ProcessScript, ScriptCompileError, ScriptDraft, ScriptImportResult, ScriptReadResult,
  ScriptSaveResult, ScriptType,
} from '@common/types';

import {
  countProcessedByScript, deleteScriptRows, getAllScripts, getScriptById, getScriptsByType,
  insertScript, renameScript as renameScriptRow, setScriptFilePath, setScriptTypes, touchScriptLoadedAt,
} from '@/database/db';
import { inspectScript } from '@/script/compile';
import { BUILTIN_SCRIPT } from '@/script/defaults';
import {
  ensureScriptsDir, listDrafts, newScriptPath, readDraft, readScriptFile, readScriptSource,
  removeDraft, removeScriptFile, scriptFileExists, writeDraft, writeFileAtomic,
} from '@/script/files';

// ------------------------------------------------------------
// 草稿 key
// ------------------------------------------------------------

/** 已入库脚本的草稿 key；新建未保存的用渲染进程给的 `new-<uuid>` 原样透传 */
function draftKeyOf(id: number): string {
  return `script-${id}`;
}

/** 文件不存在时的编译错误：位置给不出来，消息里带路径 */
function missingFileError(filePath: string): ScriptCompileError {
  return { message: `脚本文件不存在：${filePath}`, line: null, column: null };
}

// ------------------------------------------------------------
// 查询
// ------------------------------------------------------------

/** 列出全部脚本；只要行，正文在文件里 */
export function listScripts(): ProcessScript[] {
  return getAllScripts();
}

/** 按类型列出脚本：扫描与批量处理的下拉用它 */
export function listScriptsByType(type: ScriptType): ProcessScript[] {
  return getScriptsByType(type);
}

/**
 * 只做检查：编译一段代码，报告它导出了哪些方法与错误。
 *
 * **什么都不落**——不写文件、不动类型关联、不碰草稿（草稿由 putScriptDraft 负责）。
 * 编辑时按防抖调它，于是状态图标与类型标签用的一直是最新的那份代码，不必等到保存。
 */
export function checkScript(
  code: string,
  filePath: string,
): { types: ScriptType[]; compileError: ScriptCompileError | null } {
  return inspectScript(code, filePath);
}

/** 图库里有几条记录来自这个脚本：删除前的确认框要显示它 */
export function getScriptUsage(id: number): number {
  return countProcessedByScript(id);
}

// ------------------------------------------------------------
// 读取与保存
// ------------------------------------------------------------

/**
 * 打开一个脚本。
 *
 * 有草稿时编译的是**草稿**（编辑器显示的就是它，标记必须对得上），但类型关联只在
 * 「显示的是磁盘版本」时才更新——{@link ScriptType} 永远描述磁盘上的那一版。
 */
export async function readScript(id: number): Promise<ScriptReadResult> {
  const script = getScriptById(id);
  if (!script) {
    throw new Error(`脚本不存在（id=${id}）`);
  }

  const draft = await readDraft(draftKeyOf(id));
  const exists = await scriptFileExists(script.filePath);
  if (!exists && draft === null) {
    setScriptTypes(id, []);
    return { code: '', compileError: missingFileError(script.filePath), types: [], draft: null };
  }

  const code = exists ? await readScriptSource(script.filePath) : '';
  const inspected = inspectScript(draft !== null ? draft.code : code, script.filePath);
  if (draft === null) {
    setScriptTypes(id, inspected.types);
  }
  // types 取库里那一份：显示草稿时它仍然是磁盘版本的关联
  return { code, compileError: inspected.compileError, types: getScriptById(id)!.types, draft };
}

/**
 * 保存一个脚本：写文件、建行或更新行、重新检测类型，最后丢掉那一份草稿。
 *
 * **编译失败也照写文件**：代码是使用者的东西，错误只体现在类型关联与返回的 compileError 上。
 * 名称变了走 renameScript()，由它把图库里的名字副本一起改掉。
 */
export async function saveScript(input: {
  id: number | null;
  name: string;
  code: string;
  /** 当前编辑器对应的草稿 key：保存成功后要删掉它 */
  draftKey: string;
}): Promise<ScriptSaveResult> {
  const name = input.name.trim();
  if (name === '') {
    throw new Error('脚本名称不能为空');
  }

  const existing = input.id === null ? undefined : getScriptById(input.id);
  if (input.id !== null && !existing) {
    throw new Error(`脚本不存在（id=${input.id}）`);
  }

  await ensureScriptsDir();
  const filePath = existing ? existing.filePath : newScriptPath();
  await writeFileAtomic(filePath, input.code);

  const inspected = inspectScript(input.code, filePath);
  const id = existing ? existing.id : insertScript(name, filePath, false).id;
  if (existing && existing.name !== name) {
    renameScriptRow(id, name);
  }
  touchScriptLoadedAt(id);
  setScriptTypes(id, inspected.types);

  await removeDraft(input.draftKey);
  return { script: getScriptById(id)!, compileError: inspected.compileError };
}

/**
 * 改脚本的显示名。
 *
 * 名字在库里，图库那一列的名字副本由 `renameScriptRow` 一并改掉（见 database/db.ts）；
 * 有草稿的连草稿里的名字一起改，否则列表会继续显示草稿里那个旧名字。
 */
export async function renameScript(id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('脚本名称不能为空');
  }

  renameScriptRow(id, trimmed);

  const key = draftKeyOf(id);
  const draft = await readDraft(key);
  if (draft !== null) {
    await writeDraft({ ...draft, name: trimmed });
  }
}

/**
 * 从磁盘导入脚本：**复制**一份到 `scripts/` 下，原文件此后不再被读写。
 *
 * 名称取源文件名去掉扩展名（`default.js` → `default`）；逐个 try，一份失败不影响其余，
 * 失败原因收在结果里由界面汇总——静默跳过是禁止的。
 */
export async function importScripts(sourcePaths: string[]): Promise<ScriptImportResult> {
  await ensureScriptsDir();
  const imported: ProcessScript[] = [];
  const failed: { path: string; message: string }[] = [];

  for (const sourcePath of sourcePaths) {
    try {
      const source = await readScriptFile(sourcePath);
      const filePath = newScriptPath();
      await writeFileAtomic(filePath, source);

      const base = basename(sourcePath);
      const name = base.replace(/\.[^.]*$/, '') || base;
      const script = insertScript(name, filePath, false);
      setScriptTypes(script.id, inspectScript(source, filePath).types);
      imported.push(getScriptById(script.id)!);
    } catch (error) {
      failed.push({ path: sourcePath, message: (error as Error).message });
    }
  }

  return { imported, failed };
}


// ------------------------------------------------------------
// 删除与恢复默认
// ------------------------------------------------------------

/**
 * 删除脚本：行、正文文件、草稿一起清掉。
 *
 * **不动图库**：`processed_image.script_name` 存着这个名字的副本，删掉脚本正好让它成为
 * 最后一份记录；`script_id` 留作历史引用（悬空无害，AUTOINCREMENT 不复用 id）。
 */
export async function deleteScript(id: number): Promise<void> {
  const script = getScriptById(id);
  if (!script) {
    return;
  }
  if (script.builtin) {
    throw new Error('内置脚本不能删除');
  }

  deleteScriptRows(id);
  await removeScriptFile(script.filePath);
  await removeDraft(draftKeyOf(id));
}

/**
 * 用随应用发布的内置源码覆盖内置脚本。
 *
 * 名字是使用者的，不动；文件被外部删掉时这一步也把它重建出来。
 */
export async function resetBuiltinScript(id: number): Promise<ScriptSaveResult> {
  const script = getScriptById(id);
  if (!script?.builtin) {
    throw new Error('只有内置脚本可以恢复默认');
  }

  await ensureScriptsDir();
  const filePath = script.filePath === '' ? newScriptPath() : script.filePath;
  await writeFileAtomic(filePath, BUILTIN_SCRIPT.source);
  setScriptFilePath(id, filePath);

  const inspected = inspectScript(BUILTIN_SCRIPT.source, filePath);
  setScriptTypes(id, inspected.types);
  await removeDraft(draftKeyOf(id));

  return { script: getScriptById(id)!, compileError: inspected.compileError };
}

// ------------------------------------------------------------
// 草稿
// ------------------------------------------------------------

/**
 * 清掉孤儿草稿：key 指向的脚本已经不存在了。
 *
 * `new-` 开头的草稿是「新建未保存」的，库里还没有对应行，保留。
 */
async function pruneOrphanDrafts(): Promise<void> {
  for (const draft of await listDrafts()) {
    if (!draft.key.startsWith('script-')) {
      continue;
    }
    const id = Number(draft.key.slice('script-'.length));
    if (!Number.isInteger(id) || getScriptById(id) === undefined) {
      await removeDraft(draft.key);
    }
  }
}

/** 列出全部草稿：打开脚本页时读一次，界面据此标出「未保存」 */
export async function listScriptDrafts(): Promise<ScriptDraft[]> {
  await pruneOrphanDrafts();
  return listDrafts();
}

/** 写一份草稿；一稿一文件，只有改动的那一份被重写 */
export async function putScriptDraft(key: string, draft: { name: string; code: string }): Promise<void> {
  await writeDraft({ key, name: draft.name, code: draft.code, updatedAt: new Date().toISOString() });
}

/** 丢弃一份草稿：保存成功后、或者使用者点「放弃修改」时 */
export async function deleteScriptDraft(key: string): Promise<void> {
  await removeDraft(key);
}
