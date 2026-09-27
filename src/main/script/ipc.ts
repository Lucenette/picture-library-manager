import { BrowserWindow, Menu, ipcMain } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { ScriptMenuEntry, ScriptType } from '@common/types';

import {
  assignScriptGroup, checkScript, createScriptGroup, deleteScript, deleteScriptDraft, deleteScriptGroup,
  getScriptUsage, importScripts, listScriptDrafts, listScriptGroups, listScripts, listScriptsByType,
  putScriptDraft, readScript, renameScript, renameScriptGroup, resetBuiltinScript, saveScript,
  setScriptGroupCollapsed,
} from '@/script/library';

/** 正弹着的那份菜单：popup 返回之前不能被回收，否则原生菜单会跟着消失 */
let openMenu: Menu | null = null;

/**
 * 弹一次原生右键菜单，返回点中的动作 id；点到别处把菜单关掉时返回 null。
 *
 * 原生菜单只能由主进程弹（`Menu.popup`），而「有哪些项」是界面的事：清单由渲染进程按当前状态给。
 */
function popupScriptMenu(window: BrowserWindow, entries: ScriptMenuEntry[]): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(
      entries.map((entry) => ({
        label: entry.label,
        click: () => resolve(entry.id),
      })),
    );
    openMenu = menu;
    menu.popup({
      window,
      callback: () => {
        // 关掉之后再放手：这一读同时保证「弹着的菜单一直有人引用」，否则它可能被回收
        if (openMenu === menu) {
          openMenu = null;
        }
        resolve(null);
      },
    });
  });
}

/** 保存命令的入参：草稿 key 由渲染进程给，保存成功后要删掉它 */
interface SaveScriptInput {
  id: number | null;
  name: string;
  code: string;
  draftKey: string;
  /** 新脚本落在哪一组；已入库脚本的归属走 SCRIPT_GROUP_ASSIGN */
  groupId: number | null;
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
  // 检查不落任何东西：编辑时按防抖调它，状态图标与类型标签不必等到保存才更新
  ipcMain.handle(IPC.SCRIPT_CHECK, (_event, code: string, filePath: string) => checkScript(code, filePath));
  ipcMain.handle(IPC.SCRIPT_IMPORT, (_event, paths: string[], groupId: number | null) =>
    importScripts(paths, groupId),
  );
  ipcMain.handle(IPC.SCRIPT_SAVE, (_event, input: SaveScriptInput) => saveScript(input));
  ipcMain.handle(IPC.SCRIPT_DELETE, (_event, id: number) => deleteScript(id));
  ipcMain.handle(IPC.SCRIPT_USAGE, (_event, id: number) => getScriptUsage(id));
  ipcMain.handle(IPC.SCRIPT_RESET_BUILTIN, (_event, id: number) => resetBuiltinScript(id));
  ipcMain.handle(IPC.SCRIPT_DRAFT_LIST, () => listScriptDrafts());
  ipcMain.handle(
    IPC.SCRIPT_DRAFT_PUT,
    (_event, key: string, draft: { name: string; code: string; groupId?: number | null }) =>
      putScriptDraft(key, draft),
  );
  ipcMain.handle(IPC.SCRIPT_DRAFT_DELETE, (_event, key: string) => deleteScriptDraft(key));

  ipcMain.handle(IPC.SCRIPT_RENAME, (_event, id: number, name: string) => renameScript(id, name));

  ipcMain.handle(IPC.SCRIPT_GROUP_LIST, () => listScriptGroups());
  ipcMain.handle(IPC.SCRIPT_GROUP_CREATE, (_event, name: string) => createScriptGroup(name));
  ipcMain.handle(IPC.SCRIPT_GROUP_RENAME, (_event, id: number, name: string) => renameScriptGroup(id, name));
  ipcMain.handle(IPC.SCRIPT_GROUP_DELETE, (_event, id: number) => deleteScriptGroup(id));
  ipcMain.handle(IPC.SCRIPT_GROUP_COLLAPSE, (_event, id: number, collapsed: boolean) =>
    setScriptGroupCollapsed(id, collapsed),
  );
  ipcMain.handle(IPC.SCRIPT_GROUP_ASSIGN, (_event, scriptId: number, groupId: number | null) =>
    assignScriptGroup(scriptId, groupId),
  );

  ipcMain.handle(IPC.SCRIPT_MENU, (event, entries: ScriptMenuEntry[]) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return null;
    }
    return popupScriptMenu(window, entries);
  });
}
