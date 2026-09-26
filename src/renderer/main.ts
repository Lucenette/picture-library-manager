import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import 'element-plus/dist/index.css';
import '@/styles/theme.css';
import App from '@/App.vue';
import LoadingPage from '@/views/startup/LoadingPage.vue';

/**
 * 全部窗口共用同一份渲染进程入口，通过 hash 路由区分身份。
 *
 * **除加载页外全部按需加载**：每个原生窗口都是一次独立的文档加载，静态导入意味着任何一个小弹窗
 * 都要把整个应用求值一遍。实测每个窗口的公共开销从 26 个模块 / 133 KB 源码降到只有基座本身。
 *
 * 弹窗能这样做，是因为初始数据由弹窗**挂载后自己去主进程取**（invoke `*_INIT`）：主进程不在
 * `did-finish-load` 时推送，否则组件挂载晚于该事件、消息会丢——这正是按需加载的前提。
 *
 * 加载页必须静态导入：它是主窗口的第一屏，晚一个来回才画出来就白做了。
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

    { path: '/viewer', name: 'viewer', component: () => import('@/views/image/ImageViewer.vue') },
    { path: '/scan-config', name: 'scanConfig', component: () => import('@/views/dialogs/ScanConfigDialog.vue') },
    { path: '/batch-process', name: 'batchProcess', component: () => import('@/views/dialogs/BatchProcessDialog.vue') },
    { path: '/confirm', name: 'confirm', component: () => import('@/views/dialogs/ConfirmDialog.vue') },
    { path: '/prompt', name: 'prompt', component: () => import('@/views/dialogs/PromptDialog.vue') },
    { path: '/file-viewer', name: 'fileViewer', component: () => import('@/views/dialogs/FileViewerDialog.vue') },
    { path: '/popup', name: 'popup', component: () => import('@/views/popups/PopupHost.vue') },
    { path: '/similar', name: 'similar', component: () => import('@/views/dialogs/SimilarDialog.vue') },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus, { locale: zhCn });

// 等首次导航完成再挂载。vue-router 的首次导航是异步的，提前挂载时 App.vue 拿到的 route.path
// 还是初始的 "/"，于是子窗口会先按「主界面」渲染出导航骨架，再切成自己的页面——肉眼可见地闪一下
// 主界面的菜单栏。路由改成按需加载后这段间隙被拉长，更明显。
await router.isReady();

app.mount('#app');
