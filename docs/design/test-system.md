# 测试系统

**状态**：现行架构
**最后更新**：2026-10-03

**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)（进程模型与分层）、[AGENTS.md](../../AGENTS.md)（改完必须自检的八条）

---

## 1. 背景

1. **仓库此前没有测试框架。** `package.json` 只有 `postinstall` / `dev` / `preview` / `icon` / `build` / `typecheck`；逻辑最密的几处（任务状态机、升级引擎、行级差分、发布说明合并）只能靠人工冒烟。
2. **原有验证手段是脚本加人工步骤：** `scripts/check-docs.mjs`、`scripts/check-code.mjs`、`yarn typecheck`、`.agents/skills/db-maintenance/scripts/verify-migration.mjs`。AGENTS.md 的八条自检里，`.vue` 模板编译与导入解析当时没有脚本兜底。
3. **可测的纯逻辑已经存在：** `ups/engine.ts`（数据库与日志以接口注入）、`database/sort/`、`image/similar.ts`、`task/task-control.ts`、`renderer/views/main/scripts/diff.ts`、`scripts/release-notes.mjs`。缺的只是一台运行器。
4. **主进程与渲染进程的 `@` 指向不同源码根**（`tsconfig.node.json` → `src/main`，`tsconfig.web.json` → `src/renderer`），一套配置同时跑两侧会互相打架——这是两份配置的直接原因。
5. **写第一批测试就抓到 bug：** 脚本编译用 `new NodeModule('')`，而 Node 的 CJS 解析器按 `module.id` 定位相对引用的基准目录，`require('./helper')` 一直解析不到；[SCRIPTING.md](../SCRIPTING.md) 里相对引用可用的承诺实际不成立。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次记录（仅登记需求） | — |
| 2026-10-02 | 方案定稿：运行器取 vitest、测试集中到根目录 `test/`、主进程与渲染进程各一份配置 | 评审确定选型与组织方式 |
| 2026-10-03 | 由 `docs/roadmap/test-system.md` 迁入，正文改写为现行说明 | 测试系统落地 |
| 2026-10-03 | 补「规则内必须带用例」的判据与检查点 | 确定测试覆盖规则 |

---

## 2. 运行器与两份配置

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

## 3. 目录组织

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

## 4. 命令与 CI

- `yarn test`（两侧依次跑）、`yarn test:main`、`yarn test:renderer`；只跑一个文件用 `yarn test:main test/main/database/sort.test.ts`。
- `.github/workflows/verify.yml` 的 `test` 作业分两步跑 `yarn test:main` 与 `yarn test:renderer`，失败能一眼看出是哪一侧。

## 5. 类型检查与规范

- `test/` 的对应目录已并入两份 tsconfig 的 `include`，`@` 按各自的映射解析，`yarn typecheck` 连测试一起查；`tsconfig.node.json` 开 `allowJs`，测试才能 import `scripts/release-notes.mjs`。
- `scripts/check-code.mjs` 的扫描范围是 `src` 与 `test`。除四条硬性规范外，它还检查 `.vue` 的 `parse` / `compileScript` / `compileTemplate`，以及 `@/`、`@common/`、`@static/` 与相对导入能否落到真实文件（`?nodeWorker` 放行、`?raw` 去掉查询后校验）。
- `check-code.mjs` 导出 `lintText(rel, content)`：测试进程内喂一段源码就能验规则，不必起子进程扫全仓库。

## 6. 覆盖范围

| 被测 | 断言要点 |
|---|---|
| `database/sort/` | 分组前缀、数字自然序、拼音、姓氏读音、确定性 |
| `image/similar.ts` | 阈值常量、相同组、第二层只连相同组、skipped |
| `task/task-control.ts` | 暂停挂起与继续、abort 抛出、清理立即执行 |
| `views/main/scripts/diff.ts` | 新增 / 删除 / 修改 / 快速通道 / 末尾退行 / 末尾换行 |
| `ups/engine.ts` | 三段顺序、已执行不重跑、failed 不算已执行、抛错回滚且只记 failed、备份保留 3 份、shouldAbort |
| `image/walk.ts`、`script/compile.ts` | 隐藏项、children 语义、白名单收集、坏图 0×0；导出类型、编译错误、相对 require |
| `contracts/` | IPC 通道值不重复、排序列都在 changelog 里、版本号唯一递增 |
| `scripts/` | check-code 的规则反例、check-docs 的占位符、release-notes 的小节合并 |

不覆盖：端到端（真实 Electron 与窗口）、渲染进程组件测试（jsdom 与 `@vue/test-utils` 以后往 `vitest.renderer.config.ts` 上加）、覆盖率门槛，以及窗口 / 对话框 / 菜单 / `nativeTheme` 这类只能人工冒烟的部分。

## 7. 改动时的检查点

- **放对边**：渲染进程的测试写进 `test/main` 会被主进程配置的 `@` 解析到错误路径。
- **同步扫描范围**：测试在 `src/` 之外，动了 tsconfig 的 `include` 或 `check-code` 的扫描根，两边要一起改。
- **测试也守规范**：`check-code` 同一套硬规则对 `test/` 生效。
- **别加 `type: module`**：`package.json` 没有它，vitest 会打 `MODULE_TYPELESS_PACKAGE_JSON` 警告；为了消警告加 `type` 会动 Electron 构建。
- **子进程要克制**：`check-code` 已能进程内验规则；`check-docs` 没有可 import 的入口，对应测试只能起子进程（约 0.5s / 次）。
- **规则内必须带用例**：不触达 Electron 与 DOM 的模块（纯函数、状态机、解析与编排、数据变换）改了行为就要在 `test/` 对应文件里落断言，规则外的人工冒烟即可；判据与边界见 [AGENTS.md](../../AGENTS.md) 的「测试覆盖规则」。

## 8. 已知取舍

| 取舍 | 代价 |
|---|---|
| 引入 vitest（一棵依赖树） | 多 esbuild / rollup 平台包、lock 要跟着更新；换来别名与 TS 免配置、watch 可用 |
| 测试集中在根目录 `test/` | 与源码分居两处，tsconfig 与 check-code 各要多一行；换来 `src` 不被测试混入 |
| 主 / 渲染两份配置 | `yarn test` 要跑两次；换来 `@` 不打架、jsdom 只影响渲染侧 |
| 不设覆盖率门槛 | 容易只测好测的；只要求关键不变量有断言，不追数量 |
| 不做端到端与组件测试 | 窗口、对话框、菜单仍归人工冒烟 |
