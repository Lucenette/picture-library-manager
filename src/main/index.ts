import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { join } from 'path';
import * as db from './db';

// 移除顶部菜单栏
Menu.setApplicationMenu(null);

// 关闭所有 Chrome/Electron 安全策略
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('no-sandbox');

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1f22',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: true,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('db', async (_event, method: string, ...args: any[]) => {
    const fn = (db as any)[method];
    if (typeof fn !== 'function') throw new Error(`Unknown db method: ${method}`);
    return fn(...args);
  });

  ipcMain.handle('dialog:openDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections'],
      title: '选择图库目录（可多选）',
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:openScript', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JavaScript', extensions: ['js'] }],
      title: '选择脚本文件（可多选）',
    });
    return result.canceled ? [] : result.filePaths;
  });

  // 图片查看器数据缓存
  const viewerStore = new Map<number, any>();
  let viewerWin: BrowserWindow | null = null;

  ipcMain.handle('viewer:open', async (_event, data: any) => {
    // 缓存数据，用窗口 webContents.id 做 key
    viewerStore.set(-1, data); // -1 临时存储
    if (viewerWin) viewerWin.close();
    viewerWin = new BrowserWindow({
      width: 1200, height: 800,
      backgroundColor: '#0d0d0d',
      title: '图片查看器',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        sandbox: false,
      },
    });
    viewerWin.setMenu(null);
    viewerStore.set(viewerWin.webContents.id, data);
    if (process.env.ELECTRON_RENDERER_URL) {
      viewerWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/viewer`);
    } else {
      viewerWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/viewer' });
    }
    viewerWin.on('closed', () => { viewerWin = null; });
  });

  ipcMain.handle('viewer:getData', (event) => {
    return viewerStore.get(event.sender.id) ?? viewerStore.get(-1);
  });

  ipcMain.handle('viewer:devtools', (event) => {
    event.sender.openDevTools();
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
