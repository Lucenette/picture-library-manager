import { mountPage } from '@/entries/shell/page';
import { initWindowChrome } from '@/entries/shell/window-chrome';
import '@/styles/theme.css';

initWindowChrome();

/**
 * 图片查看器入口（`viewer.html`）。
 *
 * 这个页面只用 vue / electron / `@common` 的类型，**没有任何 Element Plus 依赖**，所以它是四个
 * 入口里唯一连组件库都不引的（浮窗入口也不引，但它只有几十行 UI）。实测前它和主窗口一样要付
 * 整个 Element Plus 的代价。
 */
await mountPage({
  '/viewer': () => import('@/views/image/ImageViewer.vue'),
});
