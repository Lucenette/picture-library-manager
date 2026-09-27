import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';

import { LOAD_TASK } from '@common/ipcChannels';

import App from '@/App.vue';
import { installElementPlus } from '@/entries/shell/element-plus';
import { initWindowChrome } from '@/entries/shell/window-chrome';
import { initRendererLoading, registerRendererTask } from '@/loading';
import '@/styles/theme.css';
import LoadingPage from '@/views/startup/LoadingPage.vue';

/**
 * 主窗口入口（`index.html`）。
 *
 * 每个窗口类各有自己的入口（弹窗 `dialogs.html`、查看器 `viewer.html`、浮窗 `popup.html`），
 * 入口里只 import 这个窗口真正要用的东西——这比「一套入口 + 运行时开关」更彻底：没 import 的模块
 * 根本不进依赖图，Element Plus 这种全量注册 + 副作用 CSS 的包更是摇不掉的，只能靠别 import 它。
 *
 * 入口内部**除加载页外仍然全部按需加载**：每个原生窗口都是一次独立的文档加载，静态导入意味着
 * 主窗口要把六个页面全求值一遍。加载页必须静态导入，它是主窗口的第一屏。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'source', component: () => import('@/views/main/SourcePage.vue') },
    { path: '/scripts', name: 'scripts', component: () => import('@/views/main/ScriptPage.vue') },
    { path: '/characters', name: 'characters', component: () => import('@/views/main/CharacterPage.vue') },
    { path: '/process', name: 'process', component: () => import('@/views/main/ProcessPage.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/main/LibraryPage.vue') },
    { path: '/tasks', name: 'tasks', component: () => import('@/views/main/TaskPage.vue') },

    { path: '/loading', name: 'loading', component: LoadingPage },
  ],
});

initWindowChrome();

const app = createApp(App);
app.use(router);
installElementPlus(app);

/**
 * 预热脚本管理页：它把整个 Monaco 连同两个 worker 一起吞进自己的 chunk（十几 MB），
 * 第一次点进去要现场下载、求值，肉眼可见地卡一下。主进程的加载服务在启动阶段下发这一步。
 *
 * 分两段跑、中间各让一次空闲：求值 Monaco 与解码内联的 worker 各要占住主线程几百毫秒，
 * 抢在首屏之前跑就是白屏，分段之后加载页至少能在两段之间重画一次。
 * 第二段把 TypeScript 语言服务也点着（见 monaco-env.ts），那原本要等第一次打开编辑器才付。
 */
function warmUpEditor(): Promise<unknown> {
  return nextIdle()
    .then(() => import('@/views/main/ScriptPage.vue'))
    .then(() => nextIdle())
    .then(() => import('@/views/main/scripts/monaco-env'))
    .then((env) => env.warmUpTypeScript());
}

/** 等一次渲染进程的空闲；超时兜底，别让预热永远排不上 */
function nextIdle(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestIdleCallback(() => resolve(), { timeout: 2000 });
  });
}

registerRendererTask(LOAD_TASK.EDITOR, warmUpEditor);
// 告诉主进程「可以下发任务了」，顺带取回当前状态
void initRendererLoading();

// 等首次导航完成再挂载。vue-router 的首次导航是异步的，提前挂载时 App.vue 拿到的 route.path
// 还是初始的 "/"，于是会先按「主界面」渲染出导航骨架，再切成加载页——肉眼可见地闪一下。
await router.isReady();

app.mount('#app');
