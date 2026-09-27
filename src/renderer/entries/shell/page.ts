import { createApp, type App as VueApp, type Component } from 'vue';

/** 页面加载器：路由路径 → 组件（动态导入，只有真打开那个页面才加载它的代码） */
export type PageLoader = () => Promise<{ default: Component }>;

/**
 * 非主窗口入口的引导：按 hash 找到自己要挂的页面，等代码到位再挂上去。
 *
 * 这些窗口只有一个页面，不需要 vue-router——省一个依赖，也省掉「首次导航是异步的」那套时序。
 * 等页面 chunk 到位再挂载与主窗口一致：各窗口要么 `showWhenReady`，要么本来就隐藏着。
 *
 * 页面自己怎么取初始数据不变：挂载后去主进程 invoke（见 docs/design/window-management.md 第 8 节）。
 *
 * 这个文件只许依赖 `vue`：查看器与浮窗入口都要用它。
 */
export async function mountPage(pages: Record<string, PageLoader>, setup?: (app: VueApp) => void): Promise<void> {
  const path = window.location.hash.replace(/^#/, '') || '/';
  const loader = pages[path] ?? Object.values(pages)[0];
  const { default: page } = await loader();

  const app = createApp(page);
  setup?.(app);
  app.mount('#app');
}
