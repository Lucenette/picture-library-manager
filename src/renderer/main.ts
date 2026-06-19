import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from '@/App.vue';
import GalleryPage from '@/views/GalleryPage.vue';
import ProcessPage from '@/views/ProcessPage.vue';
import LibraryPage from '@/views/LibraryPage.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gallery', component: GalleryPage },
    { path: '/process', name: 'process', component: ProcessPage },
    { path: '/library', name: 'library', component: LibraryPage },
  ],
});

const app = createApp(App);
app.use(router);
app.use(ElementPlus);
app.mount('#app');
