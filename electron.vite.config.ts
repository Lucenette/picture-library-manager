import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['sql.js'],
      },
    },
  },
  renderer: {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    optimizeDeps: {
      exclude: ['electron'],
    },
    build: {
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
});
