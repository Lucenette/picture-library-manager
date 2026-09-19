import { app, Menu } from 'electron';
import { closeDatabase, initDatabase, initDbIpc } from '@/db';
import { initDialogs } from '@/dialogs';
import { closeAll, createMain, get } from '@/window-manager';

// ------------------------------------------------------------
// 运行时配置
// ------------------------------------------------------------

/**
 * 配置 Chromium 命令行开关。
 *
 * 开发态渲染进程由 http://localhost 提供、图片却来自 file://，必须放宽同源
 * 策略；打包后渲染进程本身就是 file://，这些开关一律不再启用。
 */
function configureCommandLine(): void {
  Menu.setApplicationMenu(null);
  process.noDeprecation = true;

  if (app.isPackaged) {
    return;
  }
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
  app.commandLine.appendSwitch('allow-running-insecure-content');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
  app.commandLine.appendSwitch('no-sandbox');
}

// ------------------------------------------------------------
// 启动
// ------------------------------------------------------------

/** 初始化数据库、IPC 与主窗口 */
async function bootstrap(): Promise<void> {
  await initDatabase();
  initDbIpc();
  initDialogs();
  createMain();
}

/** 已有实例再启动时，把焦点交还给它的主窗口 */
function focusMainWindow(): void {
  const mainWindow = get('main');
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
}

configureCommandLine();

// 数据库是单文件覆盖写，绝不允许多个实例同时持有：拿不到锁的实例直接退出
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', focusMainWindow);
  app.whenReady().then(bootstrap);
  app.on('before-quit', () => closeDatabase());
  app.on('window-all-closed', () => {
    closeAll();
    app.quit();
  });
  app.on('activate', () => {
    if (!get('main')) {
      createMain();
    }
  });
} else {
  app.quit();
}
