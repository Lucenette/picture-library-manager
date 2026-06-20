import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@common': resolve(__dirname, 'src/common'),
        '@': resolve(__dirname, 'src/main'),
      },
    },
    build: {
      rollupOptions: {
        external: ['sql.js'],
      },
    },
  },
  renderer: {
    plugins: [vue(), renderer()],
    resolve: {
      alias: {
        '@common': resolve(__dirname, 'src/common'),
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
  },
});
