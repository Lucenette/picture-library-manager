import { BrowserWindow } from 'electron';
import { join } from 'path';

/** 窗口工厂配置 */
interface WindowConfig {
  width: number;
  height: number;
  backgroundColor?: string;
  title?: string;
  route: string;
}

/** 默认 renderer 地址 */
function getUrl(hash: string): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}#${hash}`;
  }
  return `file://${join(__dirname, '../renderer/index.html')}#${hash}`;
}

const windows = new Map<string, BrowserWindow>();

const defaultWebPrefs = {
  nodeIntegration: true,
  contextIsolation: false,
  webSecurity: false,
  sandbox: false,
};

/** 创建并注册窗口 */
export function create(id: string, config: WindowConfig): BrowserWindow {
  // 如果已存在，先关旧的
  const old = windows.get(id);
  if (old && !old.isDestroyed()) {
    windows.delete(id);
    old.close();
  }

  const win = new BrowserWindow({
    width: config.width,
    height: config.height,
    backgroundColor: config.backgroundColor,
    title: config.title,
    webPreferences: defaultWebPrefs,
  });
  win.setMenu(null);
  win.loadURL(getUrl(config.route));

  win.on('closed', () => {
    if (windows.get(id) === win) windows.delete(id);
  });

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
  for (const [id, win] of windows) {
    if (!win.isDestroyed()) win.close();
  }
  windows.clear();
}

/** 创建主窗口 */
export function createMain(): BrowserWindow {
  const win = create('main', {
    width: 1400,
    height: 900,
    backgroundColor: '#1e1f22',
    route: '/',
  });
  win.on('closed', () => {
    close('viewer');
  });
  return win;
}

/** 创建图片查看器 */
export function createViewer(): BrowserWindow {
  return create('viewer', {
    width: 1200,
    height: 800,
    backgroundColor: '#0d0d0d',
    title: '图片查看器',
    route: '/viewer',
  });
}
