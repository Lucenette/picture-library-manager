import { app, dialog, Menu, type BrowserWindow } from 'electron';

import { LOAD_TASK } from '@common/ipcChannels';

import { closeDatabase, initDatabase } from '@/database/db';
import { initDialogs } from '@/dialogs';
import { warmPopup } from '@/dialogs/control/popup';
import { initLoadingIpc, registerLoadTask, startLoading, waitLoadQuit } from '@/loading';
import { createLogger, flushLogging, setupLogging } from '@/log';
import { initScriptIpc } from '@/script/ipc';
import { initTaskIpc } from '@/task/ipc';
import { taskManager } from '@/task/manager';
import { initUps } from '@/ups';
import { closeAll, createMain, get } from '@/window-manager';

/** 启动阶段的日志：窗口与库都还没建起来时的失败要能被记录 */
const log = createLogger('app');

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
 * 建主窗口、开库，再把这一轮启动要做的事登记给加载服务并跑起来。
 *
 * 窗口排在最前面：它的创建、渲染进程的启动、升级的执行三者尽量重叠，用户尽早看到界面。
 * 主窗口一律先落在加载页，加载页读加载服务公布的状态，看到终态再自己切回主界面。
 *
 * 顺序是固定的：**先开库，再升级，最后其余初始化**。升级脚本要读写数据目录里的文件、
 * 要假定库已经就绪，而它又该在「其它都还没开始」的状态下动手，所以它之后的那一串初始化
 * 也登记成任务——加载服务的终态排在所有「必须」任务之后才公布，于是「加载页收到终态时
 * 通道必然已经注册好」不再是一条要人守的约定，而是这张登记表的结论。
 */
async function bootstrap(): Promise<void> {
  const mainWindow = createMain('/loading');

  // 通道先挂上：渲染进程一挂载就会 invoke 状态快照，那同时是它的「就绪」信号
  initLoadingIpc();

  initDatabase();

  registerLoadTask({ target: 'main', kind: 'essential', title: '数据库升级', run: initUps });
  registerLoadTask({ target: 'main', kind: 'essential', title: '初始化', run: () => initRest(mainWindow) });
  registerLoadTask({ target: 'renderer', kind: 'warmup', title: '脚本编辑器', id: LOAD_TASK.EDITOR });

  if (!(await startLoading())) {
    await waitLoadQuit();
    app.quit();
  }
}

/** 升级之后的其余初始化：全是同步注册，跑完主界面才允许进来 */
function initRest(mainWindow: BrowserWindow): void {
  initTaskIpc();
  initDialogs();
  initScriptIpc();

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

// 日志排在最前面：它要能记录「开库失败」「窗口没建起来」这类事。
// 这是启动顺序里唯一的例外——它不能登记成加载服务的任务，因为加载服务自己还在初始化它。
setupLogging();

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
      const message = error instanceof Error ? error.message : String(error);
      log.error('bootstrap failed: {}', error instanceof Error ? (error.stack ?? message) : message);
      dialog.showErrorBox('启动失败', message);
      app.quit();
    });
  // 退出时先 flush 日志：dateFile 是异步写，不等它落完就会丢掉最后几行。
  // 拦一次 quit、收尾完再退，用 `quitting` 守卫避免二次进入
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) {
      return;
    }
    quitting = true;
    event.preventDefault();
    // 先终止进行中的任务，再落盘；未开始的 pending 会保留到下次启动
    taskManager.shutdown();
    flushLogging(() => {
      closeDatabase();
      app.quit();
    });
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
