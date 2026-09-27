# 测试系统

**状态**：待评审（本次只登记需求，设计待展开）
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)、[ups.md](../design/ups.md)（不依赖 electron 的引擎先例）

---

## 1. 背景

1. **仓库没有测试框架。** `package.json` 只有 `postinstall` / `dev` / `preview` / `icon` / `build` / `typecheck`，没有 `test`，依赖里也没有测试运行器。逻辑最密的几处（任务状态机、升级引擎、行级差分、发布说明合并）目前只能靠人工冒烟。
2. **现有的验证手段只有三样**：`scripts/check-docs.mjs`（零依赖，查文档编码、链接与索引，CI 里跑）、`yarn typecheck`（类型）、`.agents/skills/db-maintenance/scripts/verify-migration.mjs`（在库副本上预演迁移）。AGENTS.md「改完必须自检」里还有三条——`.vue` 模板编译、控制语句大括号、导入解析——**只有人工执行的描述，没有脚本**。
3. **可测的纯逻辑已经存在**：`ups/engine.ts`（设计上不依赖 electron）、`renderer/views/main/scripts/diff.ts`（纯函数）、`scripts/release-notes.mjs` 的小节拆分与合并、以及接下来要做的日志核心。缺的只是一台运行器。
4. **代价是可复现的**：这一轮验证 `release-notes.mjs` 的合并逻辑，只能临时写脚本把函数体抠出来跑；行级差分的正确性至今只靠人工查看。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次记录（仅登记需求，设计待展开） | — |

---

## 2. 目标与非目标

**目标**

1. 一个 `yarn test`：主进程与 `common` 的纯逻辑能在**不启动 electron** 的前提下跑。
2. 把 AGENTS.md 里那三条人工自检（模板编译、大括号、导入解析）变成脚本，并进 CI。
3. CI 在 push / PR 上跑测试，而不只是文档与类型。

**非目标**

- 不做端到端测试（真实 Electron、真实窗口）；V1 不测渲染进程组件（需要 jsdom 或 `@vue/test-utils`，是另一套成本）。
- 不设覆盖率门槛，只要求关键不变量有断言。

## 3. 待核实

- **运行器选型**：`node:test`（零依赖，与仓库「能不加依赖就不加」一致，但要解决 TypeScript 的加载方式）还是 `vitest`（需要使用者执行 `yarn add`）。
- **TS 测试文件怎么被加载**：`tsconfig` 的 include、是否需要 `tsx` 之类的加载器。
- **electron-free 的边界够不够**：`database/db.ts` 直接 `import { app } from 'electron'`；要测它，得先按 `ups/engine.ts` 的做法把核心抽出来。

## 4. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 运行器 | `node:test` + 现有工具链，不为测试引入依赖 |
| 2 | 测试文件的位置与命名 | 与被测模块同目录，`<名字>.test.ts` |
| 3 | 那三条人工自检 | 收进一个零依赖脚本（如 `scripts/selfcheck.mjs`）并在 CI 跑 |
| 4 | 首批测试对象 | 现有纯逻辑（行级差分、发布说明合并、升级计划）加上新写的日志核心 |
