import { app, dialog, Menu } from 'electron';
import { closeDatabase, initDatabase } from '@/database/db';
import { initDialogs } from '@/dialogs';
import { warmPopup } from '@/dialogs/control/popup';
import { initTaskIpc } from '@/task/ipc';
import { taskManager } from '@/task/manager';
import { initUps, waitUpsQuit } from '@/ups';
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
 * 初始化数据库、执行升级、注册其余通道，并把任务进度通知挂到主窗口上。
 *
 * 窗口排在最前面：它的创建、渲染进程的启动、升级的执行三者尽量重叠，用户尽早看到界面。
 * 主窗口一律先落在加载页，加载页读升级状态，看到终态再自己切回主界面。
 *
 * 顺序是固定的：**先开库，再升级，最后其余初始化**。升级脚本要读写数据目录里的文件、
 * 要假定库已经就绪，而它又该在「其它都还没开始」的状态下动手。
 *
 * 不变量：升级终态发出之后到所有通道注册完成之间不许有 await。加载页收到终态就切回主界面，
 * 它发来的 invoke 要等主进程回到事件循环才会被派发；只要这一段全是同步调用，就不会出现
 * 「通道还没注册就开始 invoke」。往下面加 await 就是破坏它。
 */
async function bootstrap(): Promise<void> {
  const mainWindow = createMain('/loading');

  initDatabase();

  const outcome = await initUps();
  if (!outcome.ok && !outcome.aborted) {
    await waitUpsQuit();
    app.quit();
    return;
  }

  initTaskIpc();
  initDialogs();

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

// Windows 的 AppUserModelID：必须与 electron-builder.yml 的 appId 一致，
// 任务栏分组 / 固定与通知才会归到应用名下，而不是 electron.exe
app.setAppUserModelId('com.lucenette.picture-library-manager');

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
  // 所有窗口关闭后退出。主窗口关闭时窗口管理器会先关掉其余窗口，所以这条一定会等到
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
