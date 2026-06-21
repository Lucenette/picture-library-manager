import { BrowserWindow, ipcMain } from "electron";
import type { ScriptListOpenData } from "@common/types";
import { IPC } from "@common/ipcChannels";
import * as wm from "@/window-manager";

export const initDropdown = (): void => {
    ipcMain.handle(IPC.DROPDOWN_OPEN, (_event, data: ScriptListOpenData) => {
        const parentWin = BrowserWindow.fromWebContents(_event.sender);
        if (!parentWin) return;
        const bounds = parentWin.getBounds();
        const cr = data.controlRect;
        const margin = 10;
        const x = bounds.x + cr.x;
        let y = bounds.y + cr.y + cr.height + margin;
        const screenH = require('electron').screen.getPrimaryDisplay().workAreaSize.height;
        if (y + data.listHeight > screenH - 20) y = bounds.y + cr.y - data.listHeight - margin;
        const listWin = wm.createDropdown(parentWin, x, y, cr.width, data.listHeight);
        listWin.webContents.once('did-finish-load', () => {
            listWin.webContents.send(IPC.DROPDOWN_INIT, data);
        });
    });

    ipcMain.handle(IPC.DROPDOWN_SELECT, (_event, id: number) => {
        const parent = BrowserWindow.fromWebContents(_event.sender)?.getParentWindow();
        if (parent) {
            parent.webContents.send(IPC.DROPDOWN_SELECTED, id);
        }
    });
};
