# 测试与静态检查

**状态**：现行架构
**最后更新**：2026-10-03

**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)（进程模型与分层）、[AGENTS.md](../../AGENTS.md)（改完必须自检的五条）

---

## 1. 背景

1. **仓库此前既没有测试框架，也没有 lint。** `package.json` 只有 `postinstall` / `dev` / `preview` / `icon` / `build` / `typecheck`；逻辑最密的几处（任务状态机、升级引擎、行级差分、发布说明合并）只能靠人工冒烟，形式规范只靠一个自研的 `scripts/check-code.mjs`。
2. **原有验证手段是脚本加人工步骤：** `scripts/check-docs.mjs`、`scripts/check-code.mjs`、`yarn typecheck`、`.agents/skills/db-maintenance/scripts/verify-migration.mjs`。AGENTS.md 的自检里，`.vue` 模板编译与导入解析当时没有脚本兜底。
3. **可测的纯逻辑已经存在：** `ups/engine.ts`（数据库与日志以接口注入）、`database/sort/`、`image/similar.ts`、`task/task-control.ts`、`renderer/views/main/scripts/diff.ts`、`scripts/release-notes.mjs`。缺的只是一台运行器。
4. **主进程与渲染进程的 `@` 指向不同源码根**（`tsconfig.node.json` → `src/main`，`tsconfig.web.json` → `src/renderer`），一套配置同时跑两侧会互相打架——这是测试分两份 vitest 配置、lint 按文件范围启用类型感知的直接原因。
5. **写第一批测试就抓到 bug：** 脚本编译用 `new NodeModule('')`，而 Node 的 CJS 解析器按 `module.id` 定位相对引用的基准目录，`require('./helper')` 一直解析不到；[SCRIPTING.md](../SCRIPTING.md) 里相对引用可用的承诺实际不成立。
6. **自研检查器的边界到头了：** `check-code` 只能守它写死的几条，格式化、导入顺序、类型感知的 Promise 与 `any` 都覆盖不了；继续维护等于自己重造 ESLint。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次记录（仅登记需求） | — |
| 2026-10-02 | 方案定稿：运行器取 vitest、测试集中到根目录 `test/`、主进程与渲染进程各一份配置 | 评审确定选型与组织方式 |
| 2026-10-03 | 由 `docs/roadmap/test-system.md` 迁入，正文改写为现行说明 | 测试系统落地 |
| 2026-10-03 | 补「规则内必须带用例」的判据与检查点 | 确定测试覆盖规则 |
| 2026-10-03 | 测试改用 `@test` / `@scripts` 绝对引用 | 去掉测试里的相对路径 |
| 2026-10-03 | 引入 ESLint：四条硬规则迁入，新增格式与类型感知规则，`scripts/check-code.mjs` 退役 | 用成熟 lint 取代自研检查 |
| 2026-10-03 | 把 lint 并入本文档，标题改「测试与静态检查」 | 两者同属质量保障，分两处写会漂移 |
| 2026-10-04 | 补导出符号 JSDoc 检查（`scripts/check-jsdoc.mjs`）与基准测试（`benchmarks/`） | 把口头约定变成检查，并钉住性能热点 |

---

## 2. 测试：运行器与两份配置

运行器是 **vitest**：复用 Vite 的解析链，TypeScript、ESM、路径别名全自动，watch 只跑受影响的文件。

| | `vitest.main.config.ts` | `vitest.renderer.config.ts` |
|---|---|---|
| `@` 指向 | `src/main` | `src/renderer` |
| `@common` 指向 | `src/common` | `src/common` |
| 收集 | `test/main/**`、`test/contracts/**`、`test/scripts/**` | `test/renderer/**` |
| 环境 | `node` | `node`（组件测试时换 `jsdom`） |

- 两侧都不开全局，测试里显式 `import { test, expect } from 'vitest'`，将来换运行器不必改全局类型。
- 分两份的主要收益是 `@` 各指各的：主进程测试写 `@/database/sort`，渲染进程测试写 `@/views/...`。
- `contracts/`、`scripts/` 都是 Node 侧，归主进程那份，目录单独留着。
- 两侧都定义了 `@test` → `test` 与 `@scripts` → `scripts`：测试引用共用基建与仓库脚本一律走别名，不写相对路径。

## 3. 测试：目录组织

组织形式是「镜像源码 + 三个横切目录」：找测试 = 按源文件路径找。

```
test/
├── README.md       两份配置各管谁、怎么加一个测试
├── setup/          两边共用的基建，不被当测试收集
├── main/           镜像 src/main
├── renderer/       镜像 src/renderer（只放纯逻辑）
├── contracts/      跨模块的防漂移断言（Node 侧）
└── scripts/        仓库脚本自身（Node 侧）
```

只有 `*.test.ts` 会被收集；`setup/` 靠命名天然排除。

## 4. Lint：ESLint

配置是根目录的 `eslint.config.mjs`（flat config，ESLint 10 只认这一种），命令 `yarn lint`。四套 preset 叠加：

| 来源 | 作用 |
|---|---|
| `@eslint/js` recommended | JS 基础正确性 |
| `typescript-eslint` recommended | TS 语法与常见错误（`no-explicit-any`、`no-require-imports`…） |
| `typescript-eslint` recommendedTypeChecked | 类型感知：`no-floating-promises`、`no-misused-promises`、`no-unsafe-*` |
| `eslint-plugin-vue` flat/essential | `.vue` 的脚本与模板防错（含 `vue/no-parsing-error`） |

类型感知只对两份 tsconfig 覆盖的文件开（`src/**/*.ts`、`src/**/*.vue`、`test/**/*.ts`），用 `projectService` 就近取 tsconfig；`scripts/*.mjs` 与根配置文件只吃非类型感知的规则。忽略 `dist/`、`out/`、`node_modules/`、`src/static/default-script.js`。

### 仓库专属规则

| 规则 | 来历 |
|---|---|
| `curly: ['error', 'all']` | 迁移自 `check-code`（硬性规范 2） |
| `no-restricted-syntax`（`ImportNamespaceSpecifier` / `ExportNamespaceSpecifier` / `ExportAllDeclaration`） | 迁移自 `check-code`（硬性规范 1） |
| `no-restricted-imports`：渲染进程禁全部 Node 内置，`electron` 放行 | 迁移自 `check-code`（运行时约定 1） |
| `no-restricted-imports`：`src/main/database/**` 禁 `@/ups` | 迁移自 `check-code`（运行时约定 8） |
| `no-console`（`src/**`，`src/main/log/**` 除外） | 新增：AGENTS 要求一律走 logger，此前没有强制 |
| `import-x/order` | 新增：导入顺序此前没有强制 |
| `comma-dangle: always-multiline`、`object-curly-spacing: always`、`block-spacing: always` | 新增：换行列表最后一项也要逗号、单行大括号内两侧留空格 |
| `@typescript-eslint/no-unused-vars` 放行 `^_` 前缀 | 升级脚本契约里的 `_ctx` 占位参数是有意的 |

### 边界：交给别的工具做

- **`.vue` 模板语法** → `vue/no-parsing-error`。`vue-tsc` 只查模板里的类型错误（未定义变量报 `TS2339`），不查语法错误（`{{ 1 + }}` 会放过）。
- **导入解析** → `tsc` / `vue-tsc` 本来就会报未解析的导入（`TS2307`），不另写脚本。
- **`require` 例外** → `src/main/image/thumbnail-sharp.ts` / `walk.ts` / `script/compile.ts` 有意用 `require` 拿图像依赖（不交给打包器内联），`@typescript-eslint/no-require-imports` 按文件放行。
- **`DbMethod` 的 `any`** → IPC 调度边界，参数类型由渲染进程侧保证，行内豁免。

### 首次收编

引入时一次跑出 **216 条 error / 137 个文件**。134 条是自动可修的导入顺序与多余类型断言，用 `eslint --fix` 跑了一遍并逐文件核对：副作用导入（`theme.css`、`element-plus/dist/index.css`、`monaco-env`）位置未变，非导入改动只有 4 处删多余 `as`。自动修复还留了个尾巴——`manager.ts` 删掉断言后 `TaskProgressEvent` 成了未使用导入，由 `tsc` 的 `noUnusedLocals` 抓到、手工移除。剩下 82 条人工修（Promise 的 `void` / `await`、`{ cause }`、类型收窄、死代码），最终归零。**日常不留 `lint:fix` 脚本：修复一律人（或编码代理）看过再改。**

## 5. 类型检查与文档检查

- `test/` 的对应目录已并入两份 tsconfig 的 `include`，`@` 按各自的映射解析，`yarn typecheck` 连测试一起查；`tsconfig.node.json` 开 `allowJs`，测试才能 import `scripts/release-notes.mjs`（同目录的 `release-notes.d.mts` 提供类型）。
- `node scripts/check-jsdoc.mjs` 管硬性规范 4：`src/**/*.ts` 的顶层导出符号必须有 JSDoc（零依赖，只看顶层声明）。
- `node scripts/check-docs.mjs` 管文档：编码、相对链接与锚点、`docs/roadmap` 与 `docs/design` 的 README 索引、skill frontmatter、占位符。
- `scripts/check-code.mjs` 已删除：四条规则迁进 ESLint，模板编译与导入解析分别由 `vue/no-parsing-error` 与 `typecheck` 覆盖。
- AGENTS.md 的「改完必须自检」收敛到 6 条：`tsc` / `vue-tsc` / `yarn lint` / `check-jsdoc` / `check-docs` / `yarn test`。

## 6. 命令与 CI

- `yarn test`（两侧依次跑）、`yarn test:main`、`yarn test:renderer`；只跑一个文件用 `yarn test:main test/main/database/sort.test.ts`。
- `yarn lint`（不加 `lint:fix`）。
- `.github/workflows/verify.yml`：`check` 作业跑 `yarn lint` 与 `node scripts/check-jsdoc.mjs`，`test` 作业分两步跑 `yarn test:main` 与 `yarn test:renderer`，失败能一眼看出是哪一侧。
- **基准**（不进 CI）：`npx vitest run --config vitest.bench.config.ts`。Vitest 5 移除了内置 bench API，基准写成普通 `test`、计时在 `benchmarks/harness.ts`，产物是打印出的 `xxx ms/次`；只压不依赖 Electron 与文件系统的纯函数。见 [benchmarks/README.md](../../benchmarks/README.md)。

## 7. 覆盖范围

**单元测试**

| 被测 | 断言要点 |
|---|---|
| `database/sort/` | 分组前缀、数字自然序、拼音、姓氏读音、确定性 |
| `image/similar.ts` | 阈值常量、相同组、第二层只连相同组、skipped |
| `task/task-control.ts` | 暂停挂起与继续、abort 抛出、清理立即执行 |
| `views/main/scripts/diff.ts` | 新增 / 删除 / 修改 / 快速通道 / 末尾退行 / 末尾换行 |
| `ups/engine.ts` | 三段顺序、已执行不重跑、failed 不算已执行、抛错回滚且只记 failed、备份保留 3 份、shouldAbort |
| `image/walk.ts`、`script/compile.ts` | 隐藏项、children 语义、白名单收集、坏图 0×0；导出类型、编译错误、相对 require |
| `contracts/` | IPC 通道值不重复、排序列都在 changelog 里、版本号唯一递增 |
| `scripts/` | check-docs 的占位符、release-notes 的小节合并 |

**ESLint** 覆盖四套 preset 加「仓库专属规则」那一张表。它只管正确性与约定，**不做格式化**（没有 Prettier，也没有 `lint:fix`）。

不覆盖：端到端（真实 Electron 与窗口）、渲染进程组件测试（jsdom 与 `@vue/test-utils` 以后往 `vitest.renderer.config.ts` 上加）、覆盖率门槛，以及窗口 / 对话框 / 菜单 / `nativeTheme` 这类只能人工冒烟的部分。

## 8. 改动时的检查点

- **放对边**：渲染进程的测试写进 `test/main` 会被主进程配置的 `@` 解析到错误路径。
- **同步扫描范围**：测试在 `src/` 之外，动了 tsconfig 的 `include` 或 `eslint.config.mjs` 的 `files` 范围，两边要一起改。
- **测试也守规范**：`yarn lint` 的同一套规则对 `test/` 生效；新增规则时同时看 `src` 与 `test` 会不会被误伤。
- **别加 `type: module`**：`package.json` 没有它，vitest 会打 `MODULE_TYPELESS_PACKAGE_JSON` 警告；为了消警告加 `type` 会动 Electron 构建。
- **别把 `out/` 忘了忽略**：它是构建产物，扫进去会产生大量假问题。
- **子进程要克制**：`check-docs` 没有可 import 的入口，对应测试只能起子进程（约 0.5s / 次）。
- **别名四处同步**：`@test` / `@scripts` 写在两份 vitest 配置的 `resolve.alias` 与两份 tsconfig 的 `paths` 里，新增或改名要四处一起改。
- **规则内必须带用例**：不触达 Electron 与 DOM 的模块（纯函数、状态机、解析与编排、数据变换）改了行为就要在 `test/` 对应文件里落断言，规则外的人工冒烟即可；判据与边界见 [AGENTS.md](../../AGENTS.md) 的「测试覆盖规则」。

## 9. 已知取舍

| 取舍 | 代价 |
|---|---|
| 引入 vitest（一棵依赖树） | 多 esbuild / rollup 平台包、lock 要跟着更新；换来别名与 TS 免配置、watch 可用 |
| 测试集中在根目录 `test/` | 与源码分居两处，tsconfig 与 ESLint 配置各要多一行；换来 `src` 不被测试混入 |
| 引入 ESLint（一棵依赖树） | 多 eslint / typescript-eslint / vue 插件等依赖；换来规范由工具强制，不再维护自研检查脚本 |
| 开类型感知规则 | `yarn lint` 要起 TS 程序，本机一次约一分钟；换来 `no-floating-promises` / `no-unsafe-*` 这类真问题 |
| 不提供 `lint:fix` | 修复要人看；换来不会出现没人复核的批量改动 |
| 不引入 Prettier | 格式规则留在 ESLint 核心（已弃用标记，将来可能迁 `@stylistic`）；换来少一层配置与依赖 |
| 主 / 渲染两份配置 | `yarn test` 要跑两次；换来 `@` 不打架、jsdom 只影响渲染侧 |
| 不设覆盖率门槛 | 容易只测好测的；只要求关键不变量有断言，不追数量 |
| 不做端到端与组件测试 | 窗口、对话框、菜单仍归人工冒烟 |
