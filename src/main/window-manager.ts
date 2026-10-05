import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { app, BrowserWindow, nativeTheme, type WebPreferences } from 'electron';

import { IPC } from '@common/ipcChannels';
import { DEFAULT_THEME, resolveTheme } from '@common/theme';

import { createLogger } from '@/log';

/** 本模块的日志（category `main.window`） */
const log = createLogger('window');

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/**
 * 当前这套主题的令牌。
 *
 * 「跟随系统」时每次调用都按系统的明暗重新解析，所以系统一切换就拿到新值。主进程读不到 CSS 变量，
 * 窗口底色与系统按钮字形色只能在建窗口（或系统切换）时给。
 */
function palette(): Record<string, string | undefined> {
  return resolveTheme(DEFAULT_THEME, nativeTheme.shouldUseDarkColors).tokens;
}

/** 渲染进程入口名 → 构建产物里的 HTML 文件；每个窗口类一份，见 docs/design/window-management.md 第 4 节 */
const ENTRY_HTML: Record<RendererEntry, string> = {
  index: 'index.html',
  dialogs: 'dialogs.html',
  viewer: 'viewer.html',
  popup: 'popup.html',
};

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

/** 渲染进程入口：主窗口是 index，弹窗、查看器、浮窗各有更小的一个 */
type RendererEntry = 'index' | 'dialogs' | 'viewer' | 'popup';

/** 创建窗口所需的最小配置 */
interface WindowConfig {
  /** 用哪个渲染进程入口；省略即主窗口的 index */
  entry?: RendererEntry;
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
  /**
   * 自绘标题栏：去掉系统画的标题栏，但**保留系统的窗口按钮**。
   *
   * Windows / Linux 靠 `titleBarOverlay`（Window Controls Overlay）让系统继续画最小化 / 最大化 / 关闭，
   * macOS 保留左上角的红绿灯。渲染进程那边要自己画一条标题栏（拖拽区、安全区），
   * 见 docs/design/window-management.md 第 7 节。
   */
  titleBar?: {
    /** 标题栏高度（px），必须与渲染进程那条栏相等：系统按钮在这一段里垂直居中 */
    height: number;
    /** 系统按钮那一段的底色，要与渲染进程标题栏的底色一致；省略则取 backgroundColor */
    color?: string;
  };
  minimizable?: boolean;
  maximizable?: boolean;
  resizable?: boolean;
  /** 原生控件窗口（下拉浮窗等），不打开开发者工具 */
  isControl?: boolean;
  /** 创建时是否显示；false 表示由调用方自己决定何时 show()（复用型窗口，如下拉浮窗） */
  visible?: boolean;
  /**
   * 等首帧画好再显示窗口。
   *
   * 窗口先可见、合成器还没画第一帧时，用户看到的是一个空白浅色框——比"晚一两百毫秒但一出现就是
   * 完整的"更难受。主窗口不用这个：它要尽早出现，而且空白深色框本来就是正常的启动观感（接着会有加载页）。
   */
  showWhenReady?: boolean;
}

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 已注册窗口，键为业务 id */
const windows = new Map<string, BrowserWindow>();

/**
 * 系统明暗切换时把已开的窗口也改过来。
 *
 * 界面本体由渲染进程自己听 matchMedia 改（四个入口都会挂），主进程这边只有两处：窗口底色
 * （文档绘制前的兜底色，已加载的窗口看不见）与 Windows / Linux 的系统按钮字形色——不改就会在
 * 浅色标题栏上留着浅色字形。没有 WCO 的窗口（macOS、无边框弹窗）调 setTitleBarOverlay 会抛，忽略即可。
 */
function syncSystemAppearance(): void {
  const tokens = palette();
  log.info('system appearance changed, refreshing windows: ' + (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
  for (const window of windows.values()) {
    if (window.isDestroyed()) {
      continue;
    }
    const page = tokens['--app-bg-page'];
    if (page !== undefined) {
      window.setBackgroundColor(page);
    }
    try {
      window.setTitleBarOverlay({
        color: tokens['--app-bg-header'] ?? '',
        symbolColor: tokens['--app-text-regular'] ?? '',
      });
    } catch {
      // 没有 WCO 的窗口：系统按钮不在这一层，跳过
    }
  }
}

nativeTheme.on('updated', syncSystemAppearance);

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
  const showWhenReady = config.showWhenReady ?? false;
  const visible = config.visible ?? true;
  // 自绘标题栏与无边框窗口都要摘掉系统标题栏，区别在后者连窗口按钮一并不要
  const titleBar = config.titleBar;
  const hideTitleBar = !frame || titleBar !== undefined;
  // 窗口按钮由 Windows / Linux 的 Window Controls Overlay 提供；macOS 的红绿灯是原生控件，不需要它
  const hasOverlay = hideTitleBar && !isControl && process.platform !== 'darwin';
  const overlayColor = titleBar?.color ?? config.backgroundColor ?? palette()['--app-bg-page'];
  const overlayHeight = titleBar?.height ?? 36;

  const window = new BrowserWindow({
    show: visible,
    width: config.width,
    height: config.height,
    // 兜底给深色：Electron 默认是白的，漏传就会在文档绘制前闪一下白
    backgroundColor: config.backgroundColor ?? palette()['--app-bg-page'],
    icon: devWindowIcon(),
    title: config.title,
    parent,
    modal: Boolean(parent && config.modal),
    frame,
    titleBarStyle: hideTitleBar ? 'hidden' : 'default',
    titleBarOverlay: hasOverlay
      ? { color: overlayColor, symbolColor: palette()['--app-text-regular'], height: overlayHeight }
      : undefined,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    minimizable: config.minimizable ?? true,
    maximizable: config.maximizable ?? true,
    resizable: config.resizable ?? true,
    webPreferences: createWebPreferences(),
  });

  if (hasOverlay) {
    // 窗口按钮画在系统那一层，压暗它只能走这个接口；标题栏的图标与文字在渲染进程，
    // 由它自己监听 focus/blur（见 App.vue）。macOS 的红绿灯由系统自己变灰，这里不用管。
    const syncSymbolColor = (focused: boolean): void => {
      window.setTitleBarOverlay({
        color: overlayColor,
        symbolColor: focused ? palette()['--app-text-regular'] : palette()['--app-text-muted'],
        height: overlayHeight,
      });
    };
    window.on('focus', () => syncSymbolColor(true));
    window.on('blur', () => {
      // 自己拥有的浮窗弹出来时不算「切到别处去了」：字形色保持激活态。
      // 判据要落到「这个浮窗是这个窗口的」，否则别的窗口开下拉会把这里的压暗也去掉
      const popup = get('popup');
      if (popup?.isVisible() === true && popup.getParentWindow() === window) {
        return;
      }
      syncSymbolColor(false);
    });
  }

  if (showWhenReady && visible) {
    window.once('ready-to-show', () => window.show());
  }

  window.setMenu(null);
  void window.loadURL(getWindowUrl(config.entry ?? 'index', config.route, config.backgroundColor));
  window.on('closed', () => {
    log.info(`window closed: ${id}`);
    if (windows.get(id) === window) {
      windows.delete(id);
    }
  });
  enableDevTools(window, isControl);
  logWindowTiming(window, id, startedAt);

  windows.set(id, window);
  log.info(`window opened: ${id} (entry=${config.entry ?? 'index'}, route=${config.route})`);
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
    backgroundColor: palette()['--app-bg-page'],
    route,
    // 高度与 App.vue 的 --title-bar-height 相等，底色与 .title-bar 的 #26282c 相等
    titleBar: { height: 40, color: palette()['--app-bg-header'] },
  });
  // 主窗口是应用的生命周期锚点：它一关，其余窗口（查看器、各类弹窗、常驻的浮窗宿主）都不该再存在。
  // 由注册表统一关掉（此时 main 已被 create() 的 closed 回调移出注册表）——只关查看器是不够的：
  // 浮窗宿主建好后从不销毁，留着它就永远等不到 window-all-closed，进程会带着一个看不见的窗口挂着。
  window.on('closed', () => closeAll());
  return window;
}

/** 图片查看器窗口 */
export function createViewer(): BrowserWindow {
  return create('viewer', {
    width: 1200,
    height: 800,
    backgroundColor: palette()['--app-viewer-bg'],
    title: '图片查看器',
    route: '/viewer',
    entry: 'viewer',
    showWhenReady: true,
  });
}

/**
 * 仿原生浮窗的宿主窗口。
 *
 * 所有浮窗（脚本下拉，以后的右键菜单等）共用这一个窗口：同一时刻只可能有一个可见，没必要为
 * 每种浮窗各留一个渲染进程。与其他窗口不同，它**建好后一直复用**——渲染进程只启动一次，
 * 之后每次展开都只是换内容、重新定位并显示。每次点开都新起一个渲染进程要等一百多毫秒，
 * 浮窗这种控件等不起。
 *
 * 建好时默认隐藏；父窗口、坐标与要渲染的内容由 dialogs/control/popup.ts 在每次展开时设置。
 */
export function ensurePopup(): BrowserWindow {
  const existing = get('popup');
  if (existing) {
    return existing;
  }

  const window = create('popup', {
    width: 200,
    height: 120,
    backgroundColor: palette()['--app-bg-surface'],
    route: '/popup',
    entry: 'popup',
    frame: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    isControl: true,
    visible: false,
  });
  // 失焦即收起。可见性由主进程掌握，渲染进程不销毁这个窗口
  window.on('blur', () => window.hide());

  // 浮窗一出现它所属的窗口就失焦，但整条 chrome 不该跟着压暗。
  // 只通知**拥有这个浮窗的那个窗口**：在弹窗上开下拉，主窗口该保持压暗，别被点亮
  const notifyVisible = (visible: boolean): void => {
    const owner = window.getParentWindow();
    if (owner !== null && !owner.isDestroyed()) {
      owner.webContents.send(IPC.POPUP_VISIBLE, visible);
    }
  };
  window.on('show', () => notifyVisible(true));
  window.on('hide', () => notifyVisible(false));
  return window;
}

/** 扫描配置窗口 */
export function createScanConfig(): BrowserWindow {
  return create('scan-config', {
    width: 420,
    height: 210,
    minWidth: 420,
    minHeight: 210,
    backgroundColor: palette()['--app-bg-page'],
    route: '/scan-config',
    entry: 'dialogs',
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
    backgroundColor: palette()['--app-bg-page'],
    route: '/batch-process',
    entry: 'dialogs',
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
    backgroundColor: palette()['--app-bg-page'],
    route: '/confirm',
    entry: 'dialogs',
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
    backgroundColor: palette()['--app-bg-page'],
    route: '/prompt',
    entry: 'dialogs',
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
    backgroundColor: palette()['--app-bg-page'],
    route: '/file-viewer',
    entry: 'dialogs',
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
    backgroundColor: palette()['--app-bg-page'],
    title: '相似图片',
    route: '/similar',
    entry: 'dialogs',
    showWhenReady: true,
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

/**
 * 渲染进程地址：开发态走 Vite 服务，打包后走本地文件。
 *
 * 顺带把窗口自己的底色作为查询参数带上，渲染进程的首帧就能用它作背景，
 * 不必等组件样式到位（否则下拉浮窗、图片查看器会先闪一下默认色）。
 */
function getWindowUrl(entry: RendererEntry, route: string, background?: string): string {
  const query = background ? `?bg=${encodeURIComponent(background)}` : '';
  const file = ENTRY_HTML[entry];
  if (process.env.ELECTRON_RENDERER_URL) {
    return `${process.env.ELECTRON_RENDERER_URL}/${file}${query}#${route}`;
  }
  const html = resolve(__dirname, '../renderer', file);
  return `${pathToFileURL(html).href}${query}#${route}`;
}

/**
 * 开发态的窗口与任务栏图标。
 *
 * 打包后 Windows 直接取 exe 内嵌的图标，传路径没有意义：`src/` 不在打包白名单里，
 * 找不到文件反而会让窗口图标变空。
 */
function devWindowIcon(): string | undefined {
  return app.isPackaged ? undefined : resolve(__dirname, '../../src/static/icon.png');
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
    log.debug(`window ${id} document loaded in ${Date.now() - startedAt}ms`);
  });
  window.once('ready-to-show', () => {
    log.debug(`window ${id} first frame ready in ${Date.now() - startedAt}ms`);
  });
}

/**
 * 开发态自动打开开发者工具，并支持 F12 切换。
 *
 * 每个窗口都自动开一个 detached DevTools 是**有意为之**（使用者的开发习惯），不是性能疏忽，
 * 不要当成"窗口慢"的原因删掉：它只在开发态生效，打包后完全不执行。
 */
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
