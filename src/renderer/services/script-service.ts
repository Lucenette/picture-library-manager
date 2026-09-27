import { ipcRenderer } from 'electron';

import { IPC } from '@common/ipcChannels';
import type {
  ProcessScript, ScriptCompileError, ScriptDraft, ScriptGroup, ScriptImportResult, ScriptMenuEntry,
  ScriptReadResult, ScriptSaveResult, ScriptType,
} from '@common/types';

/**
 * 渲染进程的脚本子系统包装。
 *
 * 与 {@link import('@/db/database')} 那个「数据库访问层」并列：脚本操作要读写用户目录里的文件、
 * 要管草稿，所以它们走自己的一组 SCRIPT_* 通道（见 main/script/ipc.ts）。
 */
export function listScripts(): Promise<ProcessScript[]> {
  return ipcRenderer.invoke(IPC.SCRIPT_LIST) as Promise<ProcessScript[]>;
}

/** 扫描与批量处理的下拉用：只列能处理该类型的脚本 */
export function listScriptsByType(type: ScriptType): Promise<ProcessScript[]> {
  return ipcRenderer.invoke(IPC.SCRIPT_LIST_BY_TYPE, type) as Promise<ProcessScript[]>;
}

/** 打开一个脚本：磁盘正文 + 编译结果（有草稿则是草稿的）+ 它的草稿 */
export function readScript(id: number): Promise<ScriptReadResult> {
  return ipcRenderer.invoke(IPC.SCRIPT_READ, id) as Promise<ScriptReadResult>;
}

/** 只检查一段代码（导出了哪些方法、有没有错），不写任何东西也就不会改任何状态 */
export function checkScript(
  code: string,
  filePath: string,
): Promise<{ types: ScriptType[]; compileError: ScriptCompileError | null }> {
  return ipcRenderer.invoke(IPC.SCRIPT_CHECK, code, filePath) as Promise<{
    types: ScriptType[];
    compileError: ScriptCompileError | null;
  }>;
}

/** 导入脚本：主进程把源文件复制进用户目录的 scripts/ 下，并落到指定分组（null = 未分组） */
export function importScripts(paths: string[], groupId: number | null): Promise<ScriptImportResult> {
  return ipcRenderer.invoke(IPC.SCRIPT_IMPORT, paths, groupId) as Promise<ScriptImportResult>;
}

/** 保存：写文件 + 更新行 + 重新检测类型；编译失败也照样落盘 */
export function saveScript(input: {
  id: number | null;
  name: string;
  code: string;
  draftKey: string;
  /** 新脚本落在哪一组；已入库脚本的归属走 assignScriptGroup */
  groupId: number | null;
}): Promise<ScriptSaveResult> {
  return ipcRenderer.invoke(IPC.SCRIPT_SAVE, input) as Promise<ScriptSaveResult>;
}

/** 删除脚本；图库里的名字副本不受影响 */
export function deleteScript(id: number): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_DELETE, id) as Promise<void>;
}

/** 图库里有几条记录来自这个脚本 */
export function getScriptUsage(id: number): Promise<number> {
  return ipcRenderer.invoke(IPC.SCRIPT_USAGE, id) as Promise<number>;
}

/** 用出厂源码覆盖内置脚本 */
export function resetBuiltinScript(id: number): Promise<ScriptSaveResult> {
  return ipcRenderer.invoke(IPC.SCRIPT_RESET_BUILTIN, id) as Promise<ScriptSaveResult>;
}

/** 全部未保存的草稿：进页面时读一次 */
export function listScriptDrafts(): Promise<ScriptDraft[]> {
  return ipcRenderer.invoke(IPC.SCRIPT_DRAFT_LIST) as Promise<ScriptDraft[]>;
}

/** 写一份草稿；groupId 只对 `new-` 草稿有意义（它预定这个新脚本落在哪一组） */
export function putScriptDraft(
  key: string,
  draft: { name: string; code: string; groupId?: number | null },
): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_DRAFT_PUT, key, draft) as Promise<void>;
}

/** 改脚本的显示名；主进程顺带把图库里的名字副本与草稿里的名字一起改掉 */
export function renameScript(id: number, name: string): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_RENAME, id, name) as Promise<void>;
}

/** 弹一次原生右键菜单（清单由页面按当前状态决定），返回点中的动作 id */
export function openScriptMenu(entries: ScriptMenuEntry[]): Promise<string | null> {
  return ipcRenderer.invoke(IPC.SCRIPT_MENU, entries) as Promise<string | null>;
}

/** 丢弃一份草稿 */
export function deleteScriptDraft(key: string): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_DRAFT_DELETE, key) as Promise<void>;
}

/** 列出全部分组 */
export function listScriptGroups(): Promise<ScriptGroup[]> {
  return ipcRenderer.invoke(IPC.SCRIPT_GROUP_LIST) as Promise<ScriptGroup[]>;
}

/** 建一个分组；名字允许重复，靠 id 区分 */
export function createScriptGroup(name: string): Promise<ScriptGroup> {
  return ipcRenderer.invoke(IPC.SCRIPT_GROUP_CREATE, name) as Promise<ScriptGroup>;
}

/** 改分组名 */
export function renameScriptGroup(id: number, name: string): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_GROUP_RENAME, id, name) as Promise<void>;
}

/** 删分组：组里的脚本回到「未分组」，脚本本身不会删 */
export function deleteScriptGroup(id: number): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_GROUP_DELETE, id) as Promise<void>;
}

/** 记下折叠状态；「未分组」不占库里的行，那份状态由页面自己留着 */
export function setScriptGroupCollapsed(id: number, collapsed: boolean): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_GROUP_COLLAPSE, id, collapsed) as Promise<void>;
}

/** 把脚本挪进某个分组；null = 未分组 */
export function assignScriptGroup(scriptId: number, groupId: number | null): Promise<void> {
  return ipcRenderer.invoke(IPC.SCRIPT_GROUP_ASSIGN, scriptId, groupId) as Promise<void>;
}
