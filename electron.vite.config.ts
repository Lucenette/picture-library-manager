import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import renderer from 'vite-plugin-electron-renderer';

/** 主进程与渲染进程共用的路径别名 */
const aliases = {
  '@common': resolve(__dirname, 'src/common'),
};

export default defineConfig({
  main: {
    resolve: {
      alias: {
        ...aliases,
        '@': resolve(__dirname, 'src/main'),
      },
    },
    build: {
      rollupOptions: {
        // sql.js 自带 wasm 资源，交给运行时按 Node 模块加载
        external: ['sql.js'],
      },
    },
  },
  renderer: {
    // 渲染进程需要直接使用 fs/crypto 等 Node 能力
    plugins: [vue(), renderer()],
    resolve: {
      alias: {
        ...aliases,
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
  },
});
