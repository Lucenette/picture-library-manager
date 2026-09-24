import { app, BrowserWindow, type WebPreferences } from 'electron';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

/** 创建窗口所需的最小配置 */
interface WindowConfig {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  backgroundColor?: string;
  title?: string;
  /** 渲染进程路由 */
  route: string;
  /** 父窗口 id；设置后子窗口浮于父窗口之上并随之关闭 */
  parentId?: string;
  /** 是否阻断父窗口交互，仅在设置了 parentId 后生效 */
  modal?: boolean;
  /** 是否显示系统边框，false 为无边框 */
  frame?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  resizable?: boolean;
  /** 原生控件窗口（下拉浮窗等），不打开开发者工具 */
  isControl?: boolean;
}

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 已注册窗口，键为业务 id */
const windows = new Map<string, BrowserWindow>();

// ------------------------------------------------------------
// 窗口管理
// ------------------------------------------------------------

/** 创建并注册窗口；同 id 的旧窗口会先被关闭 */
export function create(id: string, config: WindowConfig): BrowserWindow {
  const startedAt = Date.now();
  const previous = windows.get(id);
  if (previous && !previous.isDestroyed()) {
    windows.delete(id);
    previous.close();
  }

  const parent = config.parentId ? windows.get(config.parentId) : undefined;
  const frame = config.frame ?? true;
  const isControl = config.isControl ?? false;

  const window = new BrowserWindow({
    width: config.width,
    height: config.height,
    backgroundColor: config.backgroundColor,
    title: config.title,
    parent,
    modal: Boolean(parent && config.modal),
    frame,
    titleBarStyle: frame ? 'default' : 'hidden',
    titleBarOverlay: !frame && !isControl
      ? { color: config.backgroundColor || '#1e1f22', symbolColor: '#d8dadd', height: 36 }
      : undefined,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    minimizable: config.minimizable ?? true,
    maximizable: config.maximizable ?? true,
    resizable: config.resizable ?? true,
    webPreferences: createWebPreferences(),
  });

  window.setMenu(null);
  window.loadURL(getRouteUrl(config.route));
  window.on('closed', () => {
    if (windows.get(id) === window) {
      windows.delete(id);
    }
  });
  enableDevTools(window, isControl);
  logWindowTiming(window, id, startedAt);

  windows.set(id, window);
  return window;
}

/** 获取仍然存活的窗口 */
export function get(id: string): BrowserWindow | undefined {
  const window = windows.get(id);
  return window && !window.isDestroyed() ? window : undefined;
}

/** 反查窗口注册 id，未注册时返回 undefined */
export function getId(window: BrowserWindow): string | undefined {
  for (const [id, current] of windows) {
    if (current.id === window.id) {
      return id;
    }
  }
  return undefined;
}

/** 关闭并注销窗口 */
export function close(id: string): void {
  const window = windows.get(id);
  if (window && !window.isDestroyed()) {
    window.close();
  }
  windows.delete(id);
}

/** 关闭全部已注册窗口 */
export function closeAll(): void {
  for (const window of windows.values()) {
    if (!window.isDestroyed()) {
      window.close();
    }
  }
  windows.clear();
}

// ------------------------------------------------------------
// 具体窗口
// ------------------------------------------------------------

/** 主窗口；启动时可能要先展示迁移页，所以初始路由可指定 */
export function createMain(route = '/'): BrowserWindow {
  const window = create('main', {
    width: 1400,
    height: 900,
    backgroundColor: '#1e1f22',
    route,
  });
  // 主窗口关闭后图片查看器没有存在意义
  window.on('closed', () => close('viewer'));
  return window;
}

/** 图片查看器窗口 */
export function createViewer(): BrowserWindow {
  return create('viewer', {
    width: 1200,
    height: 800,
    backgroundColor: '#0d0d0d',
    title: '图片查看器',
    route: '/viewer',
  });
}

/** 脚本下拉浮窗，定位到父窗口中的控件下方或上方 */
export function createDropdown(
  parent: BrowserWindow,
  x: number,
  y: number,
  width: number,
  height: number,
): BrowserWindow {
  const window = create('script-list', {
    width,
    height,
    backgroundColor: '#2b2d30',
    route: '/script-list',
    parentId: getId(parent) || 'main',
    modal: false,
    frame: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    isControl: true,
  });
  window.setPosition(x, y);
  return window;
}

/** 扫描配置窗口 */
export function createScanConfig(): BrowserWindow {
  return create('scan-config', {
    width: 420,
    height: 210,
    minWidth: 420,
    minHeight: 210,
    backgroundColor: '#1e1f22',
    route: '/scan-config',
    parentId: 'main',
    modal: true,
    frame: false,
    minimizable: false,
    maximizable: false,
  });
}

/** 批量处理窗口 */
export function createBatchProcess(): BrowserWindow {
  return create('batch-process', {
    width: 420,
    height: 210,
    minWidth: 420,
    minHeight: 210,
    backgroundColor: '#1e1f22',
    route: '/batch-process',
    parentId: 'main',
    modal: true,
    frame: false,
    minimizable: false,
    maximizable: false,
  });
}

/** 原生确认 / 提示窗口 */
export function createConfirm(): BrowserWindow {
  return create('confirm', {
    width: 440,
    height: 208,
    minWidth: 380,
    minHeight: 190,
    backgroundColor: '#1e1f22',
    route: '/confirm',
    parentId: 'main',
    modal: true,
    frame: false,
    minimizable: false,
    maximizable: false,
  });
}

/** 通用输入窗口 */
export function createPrompt(): BrowserWindow {
  return create('prompt', {
    width: 400,
    height: 170,
    minWidth: 400,
    minHeight: 170,
    backgroundColor: '#1e1f22',
    route: '/prompt',
    parentId: 'main',
    modal: true,
    frame: false,
    minimizable: false,
    maximizable: false,
  });
}

/** 图片组文件查看窗口 */
export function createFileViewer(): BrowserWindow {
  return create('file-viewer', {
    width: 820,
    height: 560,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#1e1f22',
    route: '/file-viewer',
    parentId: 'main',
    modal: true,
    frame: false,
    minimizable: false,
    maximizable: false,
  });
}

/** 相似图片识别结果窗口 */
export function createSimilar(): BrowserWindow {
  return create('similar', {
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#1e1f22',
    title: '相似图片',
    route: '/similar',
    parentId: 'main',
    modal: false,
    frame: false,
    minimizable: true,
    maximizable: true,
  });
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 渲染进程地址：开发态走 Vite 服务，打包后走本地文件 */
function getRouteUrl(route: string): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}#${route}`;
  }
  const indexHtml = resolve(__dirname, '../renderer/index.html');
  return `${pathToFileURL(indexHtml).href}#${route}`;
}

/**
 * 全部窗口共用的 Web 能力配置。
 *
 * 渲染进程直接使用 Node 能力、不启用上下文隔离，是本项目的既有设计；
 * 同源策略则只在开发态放宽，用于从 http 页面加载 file:// 图片。
 */
function createWebPreferences(): WebPreferences {
  return {
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    // 本项目不做拼写检查，关掉可以省去每个渲染进程各自加载一次词典
    spellcheck: false,
    webSecurity: app.isPackaged,
  };
}

/**
 * 开发态记录窗口从创建到首帧的耗时。
 *
 * 用它判断一个窗口慢在哪一段：文档加载（JS 求值）还是首帧渲染；打包后不产生输出。
 */
function logWindowTiming(window: BrowserWindow, id: string, startedAt: number): void {
  if (app.isPackaged) {
    return;
  }
  window.webContents.once('did-finish-load', () => {
    console.log(`[窗口] ${id} 文档加载完成 ${Date.now() - startedAt}ms`);
  });
  window.once('ready-to-show', () => {
    console.log(`[窗口] ${id} 首帧就绪 ${Date.now() - startedAt}ms`);
  });
}

/** 开发态自动打开开发者工具，并支持 F12 切换 */
function enableDevTools(window: BrowserWindow, isControl: boolean): void {
  if (app.isPackaged || isControl) {
    return;
  }
  window.webContents.once('did-finish-load', () => {
    window.webContents.openDevTools({ mode: 'detach' });
  });
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      window.webContents.toggleDevTools();
    }
  });
}
