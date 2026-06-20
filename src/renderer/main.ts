import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import 'element-plus/dist/index.css';
import App from '@/App.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: import('@/views/GalleryPage.vue') },
    { path: '/process', name: 'process', component: import('@/views/ProcessPage.vue') },
    { path: '/library', name: 'library', component: import('@/views/LibraryPage.vue') },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
