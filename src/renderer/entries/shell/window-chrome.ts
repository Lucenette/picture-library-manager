/** macOS：左上角那一段归系统的红绿灯，标题栏不放图标 */
export const isMac = navigator.platform.startsWith('Mac');

/** 浮窗正开着：它一弹出主窗口就失焦，但那是主界面自己在展开，标题栏不该跟着压暗 */
let popupOpen = false;

/** 失焦标记的唯一出口：窗口失焦、但浮窗开着时不算失焦 */
function syncChrome(): void {
  document.documentElement.classList.toggle('window-blurred', !document.hasFocus() && !popupOpen);
}

/**
 * 由入口根据主进程的 POPUP_VISIBLE 调用（本文件不引 electron，哪个入口都能安全地引它）。
 *
 * 浮窗弹出会让主窗口失焦，可那不算「切到别处去了」——它是主界面自己在展开，所以主进程那边
 * 改窗口按钮字形色、这边改标题栏压暗，两处要一起跳过（只改一处等于没改）。
 */
export function setPopupOpen(open: boolean): void {
  popupOpen = open;
  syncChrome();
}

/**
 * 每个入口都要调的窗口级初始化：平台类 + 失焦标记。
 *
 * 失焦只加一个类（`html.window-blurred`），压暗哪些元素由样式决定（见 `styles/theme.css`）。
 * 系统窗口按钮不在这一层——Windows / Linux 的 WCO 由主进程同步改字形色，macOS 的红绿灯系统自己变灰——
 * 所以这里不需要 IPC：DOM 的 focus / blur 本来就由窗口焦点驱动，和主进程拿到的是同一个事件
 * （唯一的例外是浮窗弹出，那一条由入口转成 `setPopupOpen` 再进来）。
 *
 * 这个文件不依赖任何库，所以哪个入口都能安全地引它。
 */
export function initWindowChrome(): void {
  if (isMac) {
    document.documentElement.classList.add('platform-mac');
  }

  window.addEventListener('focus', syncChrome);
  window.addEventListener('blur', syncChrome);
  syncChrome();
}