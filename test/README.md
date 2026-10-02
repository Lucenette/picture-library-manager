# 测试

## 怎么跑

| 命令 | 范围 |
|---|---|
| `yarn test:main` | 主进程与 Node 侧：`test/main`、`test/contracts`、`test/scripts` |
| `yarn test:renderer` | 渲染进程：`test/renderer` |
| `yarn test` | 两侧依次跑 |

只跑一个文件：`yarn test:main test/main/database/sort.test.ts`（Yarn 会把额外参数接到脚本后）。

## 放哪

组织形式是「镜像源码 + 三个横切目录」：

- `test/main/**` 与 `test/renderer/**` 镜像 `src/**` 的路径，找测试 = 按源文件路径找；
- `test/contracts/**` 放跨模块的防漂移断言（通道值、changelog 与排序列的一致性），不属于单个文件；
- `test/scripts/**` 放仓库脚本自身的测试；
- `test/setup/**` 放两边共用的基建（临时目录、electron 桩、内存 store），**不会被当测试收集**；
- `test/fixtures/**` 放固定输入（最小 PNG、dbups.xml 片段），也不是测试。

## 约定

- 只有 `*.test.ts` 会被收集。
- 主进程侧 `@` 指向 `src/main`，渲染进程侧 `@` 指向 `src/renderer`——两侧各一份配置，别把渲染测试写进 `test/main`。
- 测试里显式 `import { test, expect } from 'vitest'`，不开全局。
- 测试内部引用共用基建用 `@test/setup/...`，引用仓库脚本用 `@scripts/...`；**不写相对路径**（两个别名在两份 vitest 配置与两份 tsconfig 的 paths 里都有）。
- 测试代码同样受 `yarn lint` 的规则约束。
