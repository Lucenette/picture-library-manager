import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import 'element-plus/dist/index.css';
import '@/styles/theme.css';
import App from '@/App.vue';
import BatchProcessDialog from '@/views/dialogs/BatchProcessDialog.vue';
import ConfirmDialog from '@/views/dialogs/ConfirmDialog.vue';
import FileViewerDialog from '@/views/dialogs/FileViewerDialog.vue';
import PromptDialog from '@/views/dialogs/PromptDialog.vue';
import ScanConfigDialog from '@/views/dialogs/ScanConfigDialog.vue';
import Dropdown from '@/views/dialogs/control/Dropdown.vue';
import LoadingPage from '@/views/startup/LoadingPage.vue';

/**
 * 全部窗口共用同一份渲染进程入口，通过 hash 路由区分身份。
 *
 * **按需加载**：主界面那六个页面只有主窗口用得到，做成动态导入后任何弹窗都不再需要把它们
 * 求值一遍——实测每个窗口今天要背 26 个模块 / 133 KB 源码，而一个确认框自己只要 3 个 / 17 KB。
 * 图片查看器与相似图窗口同理：它们的初始数据是自己去主进程取的（invoke）。
 *
 * **必须保持静态导入的**：确认框、输入框、文件查看、扫描配置、批量处理、脚本下拉这六个，初始数据
 * 由主进程在 `did-finish-load` 时 push 过来（CONFIRM_INIT / PROMPT_INIT / …）。改成动态导入后
 * 组件挂载会晚于 `did-finish-load`，那批消息就丢了，窗口会是空的。要动它们，得先改成挂载后
 * 自己去取（invoke）。
 *
 * 加载页也必须静态导入：它是主窗口的第一屏，晚一个来回才画出来就白做了。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: () => import('@/views/main/GalleryPage.vue') },
    { path: '/scripts', name: 'scripts', component: () => import('@/views/main/ScriptPage.vue') },
    { path: '/characters', name: 'characters', component: () => import('@/views/main/CharacterPage.vue') },
    { path: '/process', name: 'process', component: () => import('@/views/main/ProcessPage.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/main/LibraryPage.vue') },
    { path: '/tasks', name: 'tasks', component: () => import('@/views/main/TaskPage.vue') },

    { path: '/loading', name: 'loading', component: LoadingPage },

    { path: '/viewer', name: 'viewer', component: () => import('@/views/image/ImageViewer.vue') },
    { path: '/scan-config', name: 'scanConfig', component: ScanConfigDialog },
    { path: '/batch-process', name: 'batchProcess', component: BatchProcessDialog },
    { path: '/confirm', name: 'confirm', component: ConfirmDialog },
    { path: '/prompt', name: 'prompt', component: PromptDialog },
    { path: '/file-viewer', name: 'fileViewer', component: FileViewerDialog },
    { path: '/script-list', name: 'scriptList', component: Dropdown },
    { path: '/similar', name: 'similar', component: () => import('@/views/dialogs/SimilarDialog.vue') },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
