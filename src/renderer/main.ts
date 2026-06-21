import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import 'element-plus/dist/index.css';
import '@/styles/theme.css';
import App from '@/App.vue';
import GalleryPage from '@/views/main/GalleryPage.vue';
import ScriptPage from '@/views/main/ScriptPage.vue';
import CharacterPage from '@/views/main/CharacterPage.vue';
import ProcessPage from '@/views/main/ProcessPage.vue';
import LibraryPage from '@/views/main/LibraryPage.vue';
import ImageViewer from '@/views/image/ImageViewer.vue';
import ScanConfigDialog from '@/views/dialogs/ScanConfigDialog.vue';
import BatchProcessDialog from '@/views/dialogs/BatchProcessDialog.vue';
import PromptDialog from '@/views/dialogs/PromptDialog.vue';
import FileViewerDialog from '@/views/dialogs/FileViewerDialog.vue';
import Dropdown from '@/views/dialogs/control/Dropdown.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryPage },
    { path: '/scripts', name: 'scripts', component: ScriptPage },
    { path: '/characters', name: 'characters', component: CharacterPage },
    { path: '/process', name: 'process', component: ProcessPage },
    { path: '/library', name: 'library', component: LibraryPage },
    { path: '/viewer', name: 'viewer', component: ImageViewer },
    { path: '/scan-config', name: 'scanConfig', component: ScanConfigDialog },
    { path: '/batch-process', name: 'batchProcess', component: BatchProcessDialog },
    { path: '/prompt', name: 'prompt', component: PromptDialog },
    { path: '/file-viewer', name: 'fileViewer', component: FileViewerDialog },
    { path: '/script-list', name: 'scriptList', component: Dropdown },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
