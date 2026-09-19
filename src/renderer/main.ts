import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import 'element-plus/dist/index.css';
import '@/styles/theme.css';
import App from '@/App.vue';
import BatchProcessDialog from '@/views/dialogs/BatchProcessDialog.vue';
import ConfirmDialog from '@/views/dialogs/ConfirmDialog.vue';
import Dropdown from '@/views/dialogs/control/Dropdown.vue';
import FileViewerDialog from '@/views/dialogs/FileViewerDialog.vue';
import PromptDialog from '@/views/dialogs/PromptDialog.vue';
import ScanConfigDialog from '@/views/dialogs/ScanConfigDialog.vue';
import ImageViewer from '@/views/image/ImageViewer.vue';
import CharacterPage from '@/views/main/CharacterPage.vue';
import GalleryPage from '@/views/main/GalleryPage.vue';
import LibraryPage from '@/views/main/LibraryPage.vue';
import ProcessPage from '@/views/main/ProcessPage.vue';
import ScriptPage from '@/views/main/ScriptPage.vue';
import TaskPage from '@/views/main/TaskPage.vue';

/**
 * 全部窗口共用同一份渲染进程入口，通过 hash 路由区分：
 * 无 hash 的是主窗口页面，其余都是独立的原生子窗口。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryPage },
    { path: '/scripts', name: 'scripts', component: ScriptPage },
    { path: '/characters', name: 'characters', component: CharacterPage },
    { path: '/process', name: 'process', component: ProcessPage },
    { path: '/library', name: 'library', component: LibraryPage },
    { path: '/tasks', name: 'tasks', component: TaskPage },

    { path: '/viewer', name: 'viewer', component: ImageViewer },
    { path: '/scan-config', name: 'scanConfig', component: ScanConfigDialog },
    { path: '/batch-process', name: 'batchProcess', component: BatchProcessDialog },
    { path: '/confirm', name: 'confirm', component: ConfirmDialog },
    { path: '/prompt', name: 'prompt', component: PromptDialog },
    { path: '/file-viewer', name: 'fileViewer', component: FileViewerDialog },
    { path: '/script-list', name: 'scriptList', component: Dropdown },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
