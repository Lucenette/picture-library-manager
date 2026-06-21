import { BrowserWindow, ipcMain } from "electron";
import type { ScriptListOpenData } from "@common/types";
import { IPC } from "@common/ipcChannels";
import * as wm from "@/window-manager";

export const initDropdown = (): void => {
    ipcMain.handle(IPC.SCRIPT_LIST_OPEN, (_event, data: ScriptListOpenData) => {
        const parentWin = BrowserWindow.fromWebContents(_event.sender);
        if (!parentWin) return;
        const bounds = parentWin.getBounds();
        const cr = data.controlRect;
        const itemH = 34;
        const margin = 10;
        const listH = Math.max(40, Math.min(500, data.scripts.length * itemH + 4));
        const listW = cr.width;
        const x = bounds.x + cr.x;
        let y = bounds.y + cr.y + cr.height + margin;
        const screenH = require('electron').screen.getPrimaryDisplay().workAreaSize.height;
        if (y + listH > screenH - 20) y = bounds.y + cr.y - listH - margin;
        const listWin = wm.createScriptList('scan-config', x, y, listW, listH);
        listWin.webContents.once('did-finish-load', () => {
            listWin.webContents.send(IPC.SCRIPT_LIST_INIT, data);
        });
    });

    ipcMain.handle(IPC.SCRIPT_LIST_SELECT, (_event, id: number) => {
        const parent = BrowserWindow.fromWebContents(_event.sender)?.getParentWindow();
        if (parent) {
            parent.webContents.send(IPC.SCRIPT_LIST_SELECTED, id);
        }
    });
};
