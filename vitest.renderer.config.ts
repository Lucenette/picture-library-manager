import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 渲染进程的测试配置。
 *
 * @ 在这里指向 src/renderer，与 vitest.main.config.ts 的 src/main 互不干扰；
 * 以后做组件测试（jsdom 与 @vue/test-utils）往这一份上加。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@common': fileURLToPath(new URL('./src/common', import.meta.url)),
      '@scripts': fileURLToPath(new URL('./scripts', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
  test: {
    name: 'renderer',
    include: ['test/renderer/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
