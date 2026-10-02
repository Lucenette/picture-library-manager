import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 主进程与 Node 侧的测试配置。
 *
 * 渲染进程有自己的一份（vitest.renderer.config.ts）：两边的 @ 指向不同源码根，
 * 合在一份里会互相打架。contracts 与 scripts 都是 Node 侧，归这一份。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/main', import.meta.url)),
      '@common': fileURLToPath(new URL('./src/common', import.meta.url)),
      '@scripts': fileURLToPath(new URL('./scripts', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
  test: {
    name: 'main',
    include: ['test/main/**/*.test.ts', 'test/contracts/**/*.test.ts', 'test/scripts/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
