# 测试系统

**状态**：待实施
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)、[ups.md](../design/ups.md)（依赖注入、不依赖 electron 的引擎先例）、[headless-server.md](./headless-server.md)（core 抽出来之后可测面会更大）

---

## 1. 背景

1. **仓库没有测试框架。** `package.json` 只有 `postinstall` / `dev` / `preview` / `icon` / `build` / `typecheck`，没有 `test`，依赖里也没有运行器；逻辑最密的几处（任务状态机、升级引擎、行级差分、发布说明合并）目前只能靠人工冒烟。
2. **现有验证手段有四样**：`scripts/check-docs.mjs`（文档编码、链接与索引）、`scripts/check-code.mjs`（四条硬性规范的 AST 检查）、`yarn typecheck`、`.agents/skills/db-maintenance/scripts/verify-migration.mjs`（在库副本上预演迁移）。AGENTS.md「改完必须自检」八条里，`check-code` 覆盖了控制语句大括号与渲染进程 Node 边界，**还差「.vue 模板编译」与「导入解析」没有脚本**。
3. **可测的纯逻辑已经存在**：`ups/engine.ts`（数据库与日志都以接口注入，设计上不认识 electron）、`database/sort/`（纯函数）、`image/similar.ts`、`task/task-control.ts`、`renderer/views/main/scripts/diff.ts`、`scripts/release-notes.mjs` 的小节合并。缺的只是一台运行器。
4. **主进程与渲染进程的 `@` 别名指向不同源码根**（`tsconfig.node.json` → `src/main`，`tsconfig.web.json` → `src/renderer`），一套配置同时跑两侧会互相打架——这是分成两份配置的直接原因。
5. **代价是可复现的**：上一轮验证 `release-notes.mjs` 的合并逻辑，只能临时写脚本把函数体抠出来跑；行级差分的正确性至今只靠人工查看。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次记录（仅登记需求，设计待展开） | — |
| 2026-10-02 | 定稿：运行器取 vitest，测试集中到根目录 `test/`，主进程与渲染进程各一份配置 | 评审确定选型与组织方式 |

---

## 2. 目标与非目标

**目标**

1. 三条命令各司其职：`yarn test`（两侧都跑）、`yarn test:main`、`yarn test:renderer`。
2. 测试文件全部集中在根目录 `test/`，按主进程 / 渲染进程分目录；两份 vitest 配置各管一边，各自的 `@` 指向自己的源码根。
3. 把 AGENTS.md 里剩下的两条人工自检（`.vue` 模板编译、导入解析）补成脚本，并让测试代码也受四条硬规则约束。
4. CI 在 push / PR 上跑测试。

**非目标**

- 不做端到端测试（真实 Electron、真实窗口）；
- 不设覆盖率门槛；
- v1 不做渲染进程组件测试（jsdom 与 `@vue/test-utils` 以后往渲染进程那份配置上加，是另一套成本）；
- 窗口、对话框、菜单、`nativeTheme` 这类只能人工冒烟。

## 3. 设计

### 3.1 运行器：vitest

复用 Vite 的解析链，TypeScript、ESM、路径别名全自动；watch 模式只跑受影响的文件，适合本机开发。

**代价**：多一棵依赖树（主要是 esbuild / rollup 的平台包），`yarn.lock` 要更新，CI 若用 `--ignore-scripts` 需先验证这些平台包能否装齐。

> 对比方案 `node:test`（零新增依赖）实测可行，但 Node 的 ESM 解析要求相对导入带 `.ts` 扩展名，而仓库全部是不带扩展名的写法，需要自研一个约 40 行的解析钩子来补；vitest 省掉这部分维护，代价就是上面那棵树。

### 3.2 目录

组织形式是「**镜像源码 + 三个横切目录**」：找测试 = 按源文件路径找，跨模块的东西不塞进镜像里。

```
test/
├── README.md                    约定：两份配置各管谁、怎么加一个测试
├── setup/                       两边共用的基建，不被当测试收集
│   ├── electron-stub.ts         给 paths / db / log 用的 electron 桩
│   ├── temp-dir.ts              临时目录的建与删
│   └── memory-store.ts          ups 的 MigrationStore 假实现
├── fixtures/                    固定输入
├── main/                        镜像 src/main
├── renderer/                    镜像 src/renderer（只放纯逻辑）
├── contracts/                   跨模块的防漂移断言（Node 侧）
└── scripts/                     仓库脚本自身（Node 侧）
```

命名统一 `*.test.ts`，只有 `test/**/*.test.ts` 会被收集；`setup/`、`fixtures/` 靠命名天然排除。

### 3.3 两份配置

| | `vitest.main.config.ts` | `vitest.renderer.config.ts` |
|---|---|---|
| `@` 指向 | `src/main` | `src/renderer` |
| `@common` 指向 | `src/common` | `src/common` |
| 收集 | `test/main/**`、`test/contracts/**`、`test/scripts/**` | `test/renderer/**` |
| 环境 | `node` | `node`（以后组件测试换 `jsdom`） |
| globals | `false` | `false` |

- 两侧都不开全局，测试里显式 `import { test, expect } from 'vitest'`，将来换运行器不必改全局类型。
- 分两份的**主要收益**就是 `@` 各指各的：主进程测试写 `@/database/sort`，渲染进程测试写 `@/views/...`，互不迁就。`contracts/`、`scripts/` 都是 Node 侧，归主进程那份，但目录单独留着。

### 3.4 脚本与 CI

- `package.json` 加 `test` / `test:main` / `test:renderer` 三条命令；
- `verify.yml` 加 `test` 作业，分 `yarn test:main` 与 `yarn test:renderer` 两步跑，失败能一眼看出是哪一侧。

### 3.5 类型检查与规范

- **不新建 `tsconfig.test.json`**：把 `test/` 的对应目录分别追加进现有两份 tsconfig 的 `include`，`@` 自然按 `node` / `web` 各自解析，与两份 vitest 配置一致；于是 `yarn typecheck` 连测试代码一起检查。
- `scripts/check-code.mjs` 的扫描范围从 `src` 扩到 `test`，让测试也守四条硬规则；「渲染进程不得引用 Node 内置模块」的路径前缀同时认 `test/renderer/`。

### 3.6 electron 边界与桩

1. **抽依赖注入**（首选）：`ups/engine.ts` 是范例——数据库与日志都从外面给，引擎本身不认识 electron；
2. **electron 桩**：`test/setup/electron-stub.ts` 把 `app`、`ipcMain`、`dialog` 换成假实现，让 `paths.ts`、`database/db.ts` 的核心（CRUD、账本、排序键写入）能在临时库上测；桩会与真实 Electron 漂移，只测核心逻辑，不测 Electron 行为；
3. **不测**：窗口、对话框、菜单、`nativeTheme`、worker 的真实解码——这些永远归人工冒烟。

### 3.7 首批对象（按性价比排序）

1. 纯逻辑四个：`database/sort/`、`image/similar.ts`、`task/task-control.ts`、`views/main/scripts/diff.ts`；
2. `ups/engine.ts`：换出 `MigrationStore` 与 logger，测三段顺序、已记账不再执行、脚本抛错回滚且只记 failed、备份保留 3 份、`shouldAbort`；
3. `image/walk.ts`、`script/compile.ts`：临时目录加 fixtures（最小 PNG 由 `scripts/make-fixture.mjs` 生成）；
4. `contracts/`：通道值不重复、每个排序列都在 `dbups.xml` 里、版本号唯一且递增；
5. `scripts/`：`check-docs.mjs` 与 `check-code.mjs` 的反例、`release-notes.mjs` 的小节合并（需先把纯函数导出）。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `test/` | 全部测试与共享基建：`main/`、`renderer/`、`contracts/`、`scripts/`、`setup/`、`fixtures/`、`README.md` |
| **新增** `vitest.main.config.ts` | 主进程侧：`@` → `src/main`，收集 `test/main`、`test/contracts`、`test/scripts` |
| **新增** `vitest.renderer.config.ts` | 渲染进程侧：`@` → `src/renderer`，只收集 `test/renderer` |
| `package.json` | 新增 devDependency `vitest`；scripts 加 `test` / `test:main` / `test:renderer` |
| `tsconfig.node.json`、`tsconfig.web.json` | `include` 分别追加 `test/` 的对应目录 |
| `scripts/check-code.mjs` | 扫描范围扩到 `test`；渲染进程边界的路径前缀加入 `test/renderer/` |
| `.github/workflows/verify.yml` | 加 `test` 作业，两步跑 |
| `scripts/release-notes.mjs` | 纯函数导出并加「被 import 时不执行」的守卫，才可测 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| vitest 的 esbuild / rollup 平台包在 `--ignore-scripts` 下装不齐 | 先验证；不行就让 test 作业走完整 `yarn install --frozen-lockfile` |
| 依赖树变大、`yarn.lock` 更新后忘提交 | CI 的 `--frozen-lockfile` 会直接拦下 |
| 测试文件在 `src` 之外，`tsc` / `vue-tsc` 与 `check-code` 的扫描范围要同步扩 | 已在改动清单里列全 |
| 两份配置的收集范围写错，渲染测试被主进程配置捡走 | `test/` 目录与配置一一对应；`README.md` 写明归属 |
| 旧机器上 vitest 启动比 `node:test` 重 | 单跑一侧：`yarn test:renderer` 只起一份配置；watch 同理 |
| 不设覆盖率门槛，容易只测好测的 | 只要求关键不变量有断言，不追数量 |

## 6. 验证方法

1. `yarn test:main`、`yarn test:renderer`、`yarn test` 三条都要能跑通；
2. 故意留一个失败断言，确认退出码非 0、CI 会拦；
3. 确认 `.vue` 模板编译与导入解析已进 `check-code.mjs`；
4. CI 上实际跑一次，确认两侧都能过。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 是否加一个根配置聚合两份（取决于当前 vitest 是否支持 `test.projects`） | 装完看版本再定；不支持就保持两条命令 |
| 2 | 渲染进程何时上 jsdom 与 `@vue/test-utils` | 有组件测试需求时，往 `vitest.renderer.config.ts` 上加 |
| 3 | 是否要覆盖率门槛 | 暂不，非目标 |
| 4 | `test/` 也纳入 check-code 的渲染进程 Node 边界检查 | 是 |
