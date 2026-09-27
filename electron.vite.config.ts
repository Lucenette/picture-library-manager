import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { FIRST_PAINT } from './src/renderer/entries/shell/first-paint';
import vue from '@vitejs/plugin-vue';
import renderer from 'vite-plugin-electron-renderer';

/** 主进程与渲染进程共用的路径别名 */
const aliases = {
  '@common': resolve(__dirname, 'src/common'),
  '@static': resolve(__dirname, 'src/static'),
};

/** 把 FIRST_PAINT 注入到每个入口 HTML 的占位注释处 */
function firstPaint(): Plugin {
  return {
    name: 'plm-first-paint',
    transformIndexHtml(html) {
      return html.replace('<!-- first-paint -->', () => FIRST_PAINT);
    },
  };
}

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
    plugins: [vue(), renderer(), firstPaint()],
    resolve: {
      alias: {
        ...aliases,
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    build: {
      // 每个窗口类一个入口（见 docs/design/window-management.md 第 4 节）：入口里只 import 这个
      // 窗口要用的东西，没 import 的模块根本不进依赖图——Element Plus 那种全量注册 + 副作用 CSS
      // 的包摇不掉，只能靠别 import 它
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          dialogs: resolve(__dirname, 'src/renderer/dialogs.html'),
          viewer: resolve(__dirname, 'src/renderer/viewer.html'),
          popup: resolve(__dirname, 'src/renderer/popup.html'),
        },
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
