import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import 'element-plus/dist/index.css';
import '@/styles/theme.css';
import App from '@/App.vue';
import GalleryPage from '@/views/GalleryPage.vue';
import ScriptPage from '@/views/ScriptPage.vue';
import ProcessPage from '@/views/ProcessPage.vue';
import LibraryPage from '@/views/LibraryPage.vue';
import ImageViewer from '@/views/ImageViewer.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryPage },
    { path: '/scripts', name: 'scripts', component: ScriptPage },
    { path: '/process', name: 'process', component: ProcessPage },
    { path: '/library', name: 'library', component: LibraryPage },
    { path: '/viewer', name: 'viewer', component: ImageViewer },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
