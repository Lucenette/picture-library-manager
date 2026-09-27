import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import renderer from 'vite-plugin-electron-renderer';

/** 主进程与渲染进程共用的路径别名 */
const aliases = {
  '@common': resolve(__dirname, 'src/common'),
  '@static': resolve(__dirname, 'src/static'),
};

export default defineConfig({
  main: {
    resolve: {
      alias: {
        ...aliases,
        '@': resolve(__dirname, 'src/main'),
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
    server: {
      // 编辑工具用「临时目录 + 改名」的方式原子落盘，chokidar 会去 watch 那些转瞬即逝的临时条目，
      // 在 Windows 上拿到 EBUSY；vite 的 watcher 没处理 'error' 事件，会把整个 dev 进程带崩。
      watch: {
        ignored: [/\.tmpdir([\\/]|$)/, /\.tmp$/],
      },
    },
  },
});
