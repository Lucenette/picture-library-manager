import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import * as db from './db';

/**
 * 创建主窗口
 * - nodeIntegration: true —— 渲染进程可直接 require Node 模块
 * - contextIsolation: false —— 不需要 preload，简单直接
 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** 注册数据库 IPC 通道：渲染进程 invoke('db', method, ...args) */
function registerIpc(): void {
  ipcMain.handle('db', async (_event, method: string, ...args: any[]) => {
    const fn = (db as any)[method];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown db method: ${method}`);
    }
    return fn(...args);
  });
}

app.whenReady().then(async () => {
  await db.initDatabase();
  registerIpc();
  createWindow();
});

app.on('before-quit', () => { db.closeDatabase(); });
app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
