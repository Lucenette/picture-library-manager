import { app, dialog, Menu } from 'electron';
import { sendChangesetProgress, waitForChangesetQuit } from '@/database/changeset-ipc';
import { closeDatabase, initDbIpc, initDatabase, runMigrations } from '@/database/db';
import { initDialogs } from '@/dialogs';
import { warmPopup } from '@/dialogs/control/popup';
import { initTaskIpc } from '@/task/ipc';
import { taskManager } from '@/task/manager';
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

/**
 * 初始化数据库、IPC 与主窗口，并把任务进度通知挂到主窗口上。
 *
 * 窗口排在最前面：它的创建、渲染进程的启动、changelog 的执行三者尽量重叠，用户尽早看到界面。
 * 主窗口一律先落在加载页，加载页读 changelog 的执行状态，看到终态再自己切回主界面。
 *
 * 下面的初始化是同步的，必须在第一个 await 之前跑完。先建窗口再注册通道不存在竞态：
 * ipcMain.handle 是同步注册，而渲染进程发来的 invoke 要等主进程回到事件循环才会被派发。
 * 顺序不要调换。
 */
async function bootstrap(): Promise<void> {
  const mainWindow = createMain('/loading');

  initDatabase();
  initDbIpc();
  initTaskIpc();
  initDialogs();

  const outcome = await runMigrations(sendChangesetProgress, () => !get('main'));
  if (!outcome.ok && !outcome.aborted) {
    await waitForChangesetQuit();
    app.quit();
    return;
  }

  taskManager.init(mainWindow);

  // 预先建好仿原生浮窗（隐藏）：点开时只剩换内容、定位与 show()，不必再等一个渲染进程启动
  warmPopup();
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
  app.whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      // 走到这里说明库还没打开、窗口也还没建，只能用系统原生提示框兜底
      dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error));
      app.quit();
    });
  app.on('before-quit', () => {
    // 先终止进行中的任务，再落盘；未开始的 pending 会保留到下次启动
    taskManager.shutdown();
    closeDatabase();
  });
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
