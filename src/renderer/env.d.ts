/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}

declare module 'element-plus/dist/locale/zh-cn.mjs' {
  const locale: typeof import('element-plus/es/locale/lang/zh-cn.mjs')['default'];
  export default locale;
}
