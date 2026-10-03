# 基准测试

性能敏感的纯逻辑放这里压住：排序键、相似分组的比对都随规模增长，改动它们时先看这里的数字，别只看「测试通过」。

## 怎么跑

```bash
npx vitest run --config vitest.bench.config.ts
```

Vitest 5 移除了内置的 bench API，所以基准写成普通 `test`：计时在 [harness.ts](./harness.ts)（`node:perf_hooks`，热身一次后计多轮取最快轮），
用例的产物是打印出来的 `xxx ms/次`。`vitest.bench.config.ts` 与常规测试分开，基准不进 `yarn test`，也不在 CI 的每次 push 上跑。

只跑一个文件就在命令末尾带上路径（`... benchmarks/sort-key.bench.ts`）。

## 写新基准的约定

- 只压**不依赖 Electron 与文件系统**的纯函数；要真实解码或真实网络盘，那是人工冒烟，不是基准。
- 样本在模块顶层造一次，别把造样本的时间算进被测函数。
- 名字写清规模（「1000 张图」），否则数字没有意义。
