import { mountPage } from '@/entries/shell/page';
import { initWindowChrome } from '@/entries/shell/window-chrome';
import '@/styles/theme.css';

initWindowChrome();

/**
 * 仿原生浮窗入口（`popup.html`）。
 *
 * 这个窗口只有下拉菜单那几十行 UI，却是常驻的——以前它和主窗口一样要加载整个 Element Plus
 * （实测首帧 236ms）。这里不引组件库：内容组件见 `views/popups/PopupHost.vue`，改用原生滚动。
 */
await mountPage({
  '/popup': () => import('@/views/popups/PopupHost.vue'),
});
