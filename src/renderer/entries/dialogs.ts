import { installElementPlus } from '@/entries/shell/element-plus';
import { mountPage } from '@/entries/shell/page';
import { initWindowChrome } from '@/entries/shell/window-chrome';

initWindowChrome();

/**
 * 弹窗入口（`dialogs.html`）：扫描配置、批量处理、确认、输入、文件查看、相似图结果六个窗口共用。
 *
 * 它们全都在用 Element Plus，所以这个入口仍然引它；但**不再引主窗口的骨架**（App.vue、导航栏、
 * 图标集）也不再引 vue-router——那些页面没有一个用到路由。
 */
await mountPage(
  {
    '/scan-config': () => import('@/views/dialogs/ScanConfigDialog.vue'),
    '/batch-process': () => import('@/views/dialogs/BatchProcessDialog.vue'),
    '/confirm': () => import('@/views/dialogs/ConfirmDialog.vue'),
    '/prompt': () => import('@/views/dialogs/PromptDialog.vue'),
    '/file-viewer': () => import('@/views/dialogs/FileViewerDialog.vue'),
    '/similar': () => import('@/views/dialogs/SimilarDialog.vue'),
  },
  installElementPlus,
);
