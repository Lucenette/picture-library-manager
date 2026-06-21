import { app, Menu } from 'electron';
import * as db from './db';
import * as wm from './window-manager';
import { initDbIpc } from '@/db';
import { initDialogs } from '@/dialogs';

Menu.setApplicationMenu(null);
process.noDeprecation = true;

app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  await db.initDatabase();
  initDbIpc();
  initDialogs();
  wm.createMain();
});

app.on('before-quit', () => { db.closeDatabase(); });
app.on('window-all-closed', () => { wm.closeAll(); app.quit(); });
app.on('activate', () => { if (!wm.get('main')) wm.createMain(); });
