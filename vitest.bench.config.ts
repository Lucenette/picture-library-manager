import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * 基准配置。
 *
 * 别名与 vitest.main.config.ts 相同，只把范围指向 benchmarks/。基准不进常规测试，
 * 也不在每次 push 上跑——耗时，且结果随机器波动。
 *
 * Vitest 5 已移除内置的 bench API，所以基准写成普通 test：计时在 benchmarks/harness.ts，
 * 用例的产物是打印出来的一行数字。运行：npx vitest run --config vitest.bench.config.ts
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
    name: 'bench',
    include: ['benchmarks/**/*.bench.ts'],
    environment: 'node',
    globals: false,
    // 墙钟计时不能被别的基准挤 CPU：同一时刻只跑一个
    fileParallelism: false,
    maxWorkers: 1,
    // 基准的产物就是 stdout，别让 vitest 把它拦下来再补打
    disableConsoleIntercept: true,
    // 基准是长任务：默认 5s 会把「5000 个样本跑三轮」直接掐掉
    testTimeout: 120000,
  },
});
