/** macOS：左上角那一段归系统的红绿灯，标题栏不放图标 */
export const isMac = navigator.platform.startsWith('Mac');

/**
 * 每个入口都要调的窗口级初始化：平台类 + 失焦标记。
 *
 * 失焦只加一个类（`html.window-blurred`），压暗哪些元素由样式决定（见 `styles/theme.css`）。
 * 系统窗口按钮不在这一层——Windows / Linux 的 WCO 由主进程同步改字形色，macOS 的红绿灯系统自己变灰——
 * 所以这里不需要 IPC：DOM 的 focus / blur 本来就由窗口焦点驱动，和主进程拿到的是同一个事件。
 *
 * 这个文件不依赖任何库，所以哪个入口都能安全地引它。
 */
export function initWindowChrome(): void {
  if (isMac) {
    document.documentElement.classList.add('platform-mac');
  }

  const sync = (): void => {
    document.documentElement.classList.toggle('window-blurred', !document.hasFocus());
  };
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  sync();
}
