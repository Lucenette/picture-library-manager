import ElementPlus from 'element-plus';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import type { App as VueApp } from 'vue';
import '@/styles/element-plus.css';

/**
 * 唯一引 Element Plus 的地方。**入口不许自己 import 组件库，一律走这里。**
 *
 * 它单独一个文件是有意的：查看器与浮窗的页面一行组件库都没用。只要那两份入口不 import 这个文件，
 * 它们就永远拿不到 Element Plus——拆分前实测它们和主窗口一样要加载 1,969 KB JS + 362 KB 样式。
 */
export function installElementPlus(app: VueApp): void {
  app.use(ElementPlus, { locale: zhCn });
}
