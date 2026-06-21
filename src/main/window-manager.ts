import { app, BrowserWindow } from 'electron';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

/** 窗口工厂配置 */
interface WindowConfig {
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  backgroundColor?: string;
  title?: string;
  route: string;
  parentId?: string;   // 父窗口 ID，子窗口浮在上层、跟随关闭
  modal?: boolean;      // 是否阻断父窗口交互（仅 parentId 设置后生效）
  frame?: boolean;      // 默认 true，false=无边框
  minimizable?: boolean; // 默认 true
  maximizable?: boolean; // 默认 true
  resizable?: boolean;   // 默认 true
  isControl?: boolean;   // 是否是控件，默认false
}

/** 默认 renderer 地址 */
function getUrl(hash: string): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}#${hash}`;
  }
  const indexPath = resolve(__dirname, '../renderer/index.html');
  return `${pathToFileURL(indexPath).href}#${hash}`;
}

const windows = new Map<string, BrowserWindow>();

const defaultWebPrefs = {
  nodeIntegration: true,
  contextIsolation: false,
  webSecurity: false,
  sandbox: false,
  allowFileAccessFromFileUrls: true,
};

/** 创建并注册窗口 */
export function create(id: string, config: WindowConfig): BrowserWindow {
  const old = windows.get(id);
  if (old && !old.isDestroyed()) { windows.delete(id); old.close(); }

  const parent = config.parentId ? windows.get(config.parentId) : undefined;
  const frame: boolean = config.frame ?? true;
  const isControl: boolean = config.isControl ?? false;

  const win = new BrowserWindow({
    width: config.width,
    height: config.height,
    backgroundColor: config.backgroundColor,
    title: config.title,
    parent,
    modal: !!(parent && config.modal),
    frame,
    titleBarStyle: frame ? 'default' : 'hidden',
    titleBarOverlay: (!frame && !isControl) ? { color: config.backgroundColor || '#1e1f22', symbolColor: '#d8dadd', height: 36 } : undefined,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    minimizable: config.minimizable ?? true,
    maximizable: config.maximizable ?? true,
    resizable: config.resizable ?? true,
    webPreferences: defaultWebPrefs,
  });
  win.setMenu(null);
  win.loadURL(getUrl(config.route));

  win.on('closed', () => { if (windows.get(id) === win) windows.delete(id); });

  if (!app.isPackaged && !isControl) {
    win.webContents.once('did-finish-load', () => win.webContents.openDevTools({ mode: 'detach' }));
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        win.webContents.toggleDevTools();
      }
    });
  }

  windows.set(id, win);
  return win;
}

/** 获取窗口 */
export function get(id: string): BrowserWindow | undefined {
  const win = windows.get(id);
  return win && !win.isDestroyed() ? win : undefined;
}

/** 关闭并注销 */
export function close(id: string): void {
  const win = windows.get(id);
  if (win && !win.isDestroyed()) win.close();
  windows.delete(id);
}

/** 关闭所有窗口 */
export function closeAll(): void {
  for (const [_, win] of windows) {
    if (!win.isDestroyed()) win.close();
  }
  windows.clear();
}

/** 创建主窗口 */
export function createMain(): BrowserWindow {
  const win = create('main', {
    width: 1400, height: 900,
    backgroundColor: '#1e1f22',
    route: '/',
  });
  win.on('closed', () => close('viewer'));
  return win;
}

/** 创建图片查看器 */
export function createViewer(): BrowserWindow {
  return create('viewer', {
    width: 1200, height: 800,
    backgroundColor: '#0d0d0d',
    title: '图片查看器',
    route: '/viewer',
  });
}

/** 创建脚本列表浮窗（自适应高度、不可调整大小、定位在指定坐标） */
export function createScriptList(parentId: string, x: number, y: number, w: number, h: number): BrowserWindow {
  const win = create('script-list', {
    width: w, height: h,
    backgroundColor: '#2b2d30',
    route: '/script-list',
    parentId,
    modal: false,
    frame: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    isControl: true,
  });
  win.setPosition(x, y);
  return win;
}

/** 创建扫描配置模态窗口 */
export function createScanConfig(): BrowserWindow {
  return create('scan-config', {
    width: 420, height: 210,
    minWidth: 420, minHeight: 210,
    backgroundColor: '#1e1f22',
    route: '/scan-config',
    parentId: 'main',
    modal: true,
    frame: false,
    minimizable: false,
    maximizable: false,
  });
}
