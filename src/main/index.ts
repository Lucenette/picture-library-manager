import { app, ipcMain, dialog, Menu } from 'electron';
import * as db from './db';
import * as wm from './window-manager';

Menu.setApplicationMenu(null);
process.noDeprecation = true;

// 关闭所有 Chrome/Electron 安全策略
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('no-sandbox');

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

  ipcMain.handle('dialog:exportDir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择导出目标目录',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // 图片查看器
  const viewerStore = new Map<number, any>();

  ipcMain.handle('viewer:open', async (_event, data: any) => {
    const win = wm.createViewer();
    viewerStore.set(win.webContents.id, data);
  });

  ipcMain.handle('viewer:getData', (event) => {
    return viewerStore.get(event.sender.id);
  });

  ipcMain.handle('viewer:devtools', (event) => {
    event.sender.openDevTools();
  });

  ipcMain.handle('devtools', (event) => {
    event.sender.openDevTools({ mode: 'detach' });
  });
}

app.whenReady().then(async () => {
  await db.initDatabase();
  registerIpc();
  wm.createMain();
});

app.on('before-quit', () => { db.closeDatabase(); });
app.on('window-all-closed', () => { wm.closeAll(); app.quit(); });
app.on('activate', () => { if (!wm.get('main')) wm.createMain(); });
