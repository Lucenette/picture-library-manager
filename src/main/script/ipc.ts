import { ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { ScriptType } from '@common/types';

import {
  deleteScript, deleteScriptDraft, getScriptUsage, importScripts, listScriptDrafts, listScripts,
  listScriptsByType, putScriptDraft, readScript, refreshAllScripts, resetBuiltinScript, saveScript,
} from '@/script/library';

/** 保存命令的入参：草稿 key 由渲染进程给，保存成功后要删掉它 */
interface SaveScriptInput {
  id: number | null;
  name: string;
  code: string;
  draftKey: string;
}

/**
 * 注册脚本子系统的通道。
 *
 * 脚本操作早已不只是「查库」：要读写用户目录里的文件、要创建与丢弃草稿，
 * 所以它们不挂在 DB 通道上，而是像任务那样有自己的一组（见 AGENTS「新增 IPC 的归属」）。
 */
export function initScriptIpc(): void {
  ipcMain.handle(IPC.SCRIPT_LIST, () => listScripts());
  ipcMain.handle(IPC.SCRIPT_LIST_BY_TYPE, (_event, type: ScriptType) => listScriptsByType(type));
  ipcMain.handle(IPC.SCRIPT_READ, (_event, id: number) => readScript(id));
  ipcMain.handle(IPC.SCRIPT_IMPORT, (_event, paths: string[]) => importScripts(paths));
  ipcMain.handle(IPC.SCRIPT_SAVE, (_event, input: SaveScriptInput) => saveScript(input));
  ipcMain.handle(IPC.SCRIPT_DELETE, (_event, id: number) => deleteScript(id));
  ipcMain.handle(IPC.SCRIPT_USAGE, (_event, id: number) => getScriptUsage(id));
  ipcMain.handle(IPC.SCRIPT_RESET_BUILTIN, (_event, id: number) => resetBuiltinScript(id));
  ipcMain.handle(IPC.SCRIPT_REFRESH_ALL, () => refreshAllScripts());
  ipcMain.handle(IPC.SCRIPT_DRAFT_LIST, () => listScriptDrafts());
  ipcMain.handle(IPC.SCRIPT_DRAFT_PUT, (_event, key: string, draft: { name: string; code: string }) =>
    putScriptDraft(key, draft),
  );
  ipcMain.handle(IPC.SCRIPT_DRAFT_DELETE, (_event, key: string) => deleteScriptDraft(key));
}
