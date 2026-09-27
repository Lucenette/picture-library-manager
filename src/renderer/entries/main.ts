import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from '@/App.vue';
import { installElementPlus } from '@/entries/shell/element-plus';
import { initWindowChrome } from '@/entries/shell/window-chrome';
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

// 等首次导航完成再挂载。vue-router 的首次导航是异步的，提前挂载时 App.vue 拿到的 route.path
// 还是初始的 "/"，于是会先按「主界面」渲染出导航骨架，再切成加载页——肉眼可见地闪一下。
await router.isReady();

app.mount('#app');
