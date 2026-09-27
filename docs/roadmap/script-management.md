# 脚本管理：数据目录里的脚本文件库 + 常驻编辑器

**状态**：待评审
**关联**：[升级模块 ups](../design/ups.md)——「接管旧脚本」挂在版本目录的 `preups.ts` 上（机制已落地）；先有它才能删 `code` 列

---

## 1. 背景

1. **库里的 `code` 列是当前唯一的源码副本。** 本机开发库（`dist/data/picture-lib.db`）3 条脚本里有 2 条（`default.js` 3004 字符、`single.js` 3259 字符）的 `file_path` 指向早已删除的 `data/` 目录，源码只活在库里；`docs/SCRIPTING.md` 还把「源文件丢了也不影响已入库的脚本」当成承诺。因此**任何删列动作都必须先把 `code` 落成文件**。
2. **编译错误是静默的。** `detectScriptTypes()` 捕获异常后返回空数组（`src/main/database/db.ts`），界面上只表现为「类型」列为空，与「一个已知方法都没导出」的脚本长得一样；`ScriptPage` 的「加载脚本文件」连 `try` 都没有，一次选多个文件时中间一个读失败，后面的就不再加载，也不报错。
3. **脚本正文在库里，界面上却看不到。** 列表里那列「代码」是源码前 120 字符、换行转义后的摘要（`BRIEF_MAX_LENGTH`），要知道脚本干什么只能去文件管理器打开原文件——而 `code` 全文就存在库里。
4. **一行的身份是 `file_path UNIQUE`，内置脚本用空串冒充路径。** 一旦允许「新增脚本」，空串会撞唯一约束；判断内置也只能靠「路径是否为空」这种隐式约定（`enrichScript()`）。
5. **`processed_image.script_id` 既没有外键、也没开 `PRAGMA foreign_keys`**（本机库 4175 行带 `script_id`，图库用的是 `LEFT JOIN process_script`），删脚本会让图库那一列退回「手动确认」。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-27 | 首次定稿 | — |

---

## 2. 目标与非目标

**目标**

1. 脚本正文存在 `数据目录/scripts/<uuid>.js`，库里只留索引；界面能看、能改、能报错，不必再回文件管理器。
2. 「加载脚本文件」= 复制：原始文件此后不再被读写。
3. 未保存的编辑跨脚本切换、跨页面切换、跨应用重启都不丢，并能显式放弃回到磁盘版本。
4. 编译失败是一等信息：编辑器行内标记 + 问题面板 + 类型清空 + 任务报同一个错误。
5. 老库升级不丢任何脚本源码。

**非目标**

- 不做编译结果缓存与热重载（保持现在「每次调用重新编译」的语义）；不做脚本调试器；不做多标签页编辑器；不做 IntelliSense；不改 `identify-character`「能识别但框架不调用」的现状；不改 `src/static/default-script.js` 的语义；不记录脚本来源路径；不做「在文件管理器中显示」。

## 3. 设计

### 3.1 数据目录布局

```
~/.plmanager/data/            （开发态 dist/data/）
├── picture-lib.db
├── backups/
├── scripts/<uuid>.js         脚本正文
└── drafts.json              未保存的编辑草稿
```

### 3.2 数据模型

`process_script` 最终只有 `id, name, file_path(UNIQUE), builtin, loaded_at, created_at`：`code` 与 `brief` 删除，`builtin` 变成真实的列（0/1，不再靠空串判定）。`filePath` 恒为 `scripts/` 下的绝对路径。

结构变更写进当前未发布版本 `src/main/ups/changesets/1.0.1/dbups.xml`（两条 changeSet：加 `builtin` 并把 `file_path = ''` 的行标为内置；删 `code` 与 `brief`）。**不加**编译错误列，也不加来源路径列。

`ProcessScript` 视图去掉 `code`/`brief`，`builtin` 为 `boolean`；行原始形态用内部接口承接（SQLite 给的是 0/1）。

### 3.3 接管旧脚本（`1.0.1/preups.ts`）

用 [升级模块 ups](../design/ups.md) 的 preups 时机，在删列之前把 `code` 写成文件。

**注意开发机上的账本**：1.0.1 的 preups 目前只做内置脚本入库，很可能已经跑过（账本里记着 `(script, preups, 1.0.1)`）。
按身份记账的规则下，往同一个 preups 里追加接管逻辑不会自动重跑，动手前先删掉那一行：
`DELETE FROM schema_migration WHERE author = 'script' AND filename = '1.0.1';`

1. 靠「`process_script` 是否还有 `code` 列」判断要不要接管——这一列的存在本身就是幂等标记。
2. 跳过 `file_path = ''`（内置，见 3.4）与已经在 `scripts/` 下的行（防止崩在中间后重复接管）。
3. 逐条原子写 `scripts/<uuid>.js`，再改写该行 `file_path`。
4. 任一步失败即抛错：升级中止，此时 `code` 列还在，源码不丢。

### 3.4 内置脚本

内置身份改由 `builtin` 列决定，源码仍是随应用发布的 `src/static/default-script.js`。内置那条同样落成 `scripts/<uuid>.js`（挂在 `1.0.1` 的 `postups.ts` 上——那时 `builtin` 列才存在）；文件被外部删掉时，启动按出厂源码重建——它没有用户数据可丢。「恢复默认」仍是手工路径。

### 3.5 主进程分层

| 位置 | 职责 |
|---|---|
| **新增** `src/main/script/files.ts` | 数据目录布局：`scriptsDir()`、`draftsPath()`、`newScriptPath()`（`randomUUID() + '.js'`）、`writeFileAtomic()`（tmp + rename）、读写删脚本文件、读写草稿。纯文件 IO，不碰数据库 |
| **新增** `src/main/script/library.ts` | 编排：接管、内置落盘、读取、导入、保存、全部重新检测、删除、恢复默认、草稿；`readScriptSource()` 按 path + mtime + size 缓存文件内容 |
| **新增** `src/main/script/ipc.ts` | 注册 `SCRIPT_*` 通道（`initScriptIpc()`），在 `src/main/index.ts` 的「其余初始化」里与 `initTaskIpc()` 并列 |
| `src/main/script/compile.ts` | `compileScriptModule(code, filename)` 加文件名参数；新增 `describeCompileError()` 把异常转成「消息 + 行列」 |
| `src/main/script/script-service.ts` | `executeScript` 改走 `readScriptSource`（读文件 + 每次编译），错误信息带脚本名与路径 |
| `src/main/database/db.ts` | 脚本行 CRUD 重做，删掉 `code`/`brief` 相关的一切；`DB_METHODS` 移除脚本项 |

脚本的存储与查询仍归 `database/`（只出「行」），文件与编排归 `script/`；`library.ts` 同时依赖两边，`db.ts` 不反向依赖 `script/library.ts`，避免成环。

### 3.6 关键流程

- **保存**：名称非空 → 无 id 则生成 `scripts/<uuid>.js` → **原子写文件**（编译失败也照写）→ 用真实路径编译得到类型或错误 → 建行或更新 `name`/`loaded_at` → 写类型关联（失败写空）→ 删草稿 → 返回 `{ script, compileError }`。
- **导入**：逐个源路径 try，读源文件 → 复制到 `scripts/<uuid>.js` → 编译检测类型 → 建行（名称取源文件 `basename`，与今天一致）；失败的收进结果里由界面汇总提示。
- **读取**：读文件（缺失则空正文 + 「脚本文件不存在」错误）→ 编译并返回错误；**只有内容来自磁盘文件时才更新类型关联**。不变量：**类型关联永远描述磁盘上的版本**，草稿只影响显示。
- **全部重新检测**：逐个读文件 + 编译 + 更新类型，返回每个脚本的错误，由界面汇总。只在用户点按钮时跑——它等于执行一遍所有脚本的顶层代码。
- **删除**：非内置 → 把 `processed_image.script_id` 置 NULL → 删类型关联 → 删行 → 删文件（不存在就忽略）→ 删草稿；确认框先显示受影响的图库条数。
- **恢复默认**：把出厂源码写回内置那条的文件，更新时间戳并重新检测类型，删草稿。

### 3.7 IPC

新增 `SCRIPT_*` 组（`script:list` / `listByType` / `read` / `import` / `save` / `delete` / `usage` / `resetBuiltin` / `refreshAll` / `draftList` / `draftPut` / `draftDelete`），`DB` 通道不再承载脚本操作。删除 `SCRIPT_RENAME_CONFIRMED`——改名走「名称输入框 + 保存」这一条路径。

草稿 key：已入库脚本 `script-<id>`，新建未保存 `new-<uuid>`。

### 3.8 界面

```
┌──────────────┬───────────────────────────────────────────────┐
│ [新增脚本]   │ 名称 [默认__________] 未保存                  │
│ [加载文件]   ├───────────────────────────────────────────────┤
│              │ 类型：结构 图片   ·  scripts/3f2a….js         │
│ ○ 默认       │ [保存 Ctrl+S] [放弃修改] [恢复默认/删除]      │
│ ○ default.js ├───────────────────────────────────────────────┤
│ ● 我的脚本 ● │            Monaco 编辑器（常驻）              │
│              ├───────────────────────────────────────────────┤
│              │ 问题：第 12 行第 3 列：Unexpected token ';'   │
└──────────────┴───────────────────────────────────────────────┘
```

左栏 220px 只做切换（名称 + 未保存圆点），不用 `el-table`/`el-pagination`；右栏是头部（名称、类型标签、未保存徽标、文件路径、按钮组）+ 常驻编辑器 + 问题面板（有错自动展开，无错显示「编译通过」）。页面横向不内缩，代码区尽量宽。

组件：`views/main/ScriptPage.vue`（重写，状态编排与草稿）、`views/main/scripts/ScriptSideList.vue`、`ScriptEditor.vue`、`MonacoEditor.vue`、`monaco-env.ts`，加 `services/script-service.ts`（IPC 薄包装）。`views/` 下已有 `dialogs/control/` 这种嵌套先例。

### 3.9 Monaco

固定 `monaco-editor@^0.55.0`：0.56 起 `exports` 把 `./*` 映射成 `./esm/vs/*.js`，`monaco-editor/esm/vs/...` 这类经典深导入全部失效，0.57 的入口还换成了注册全部语言的 barrel。

```ts
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';
```

worker 用 inline（blob）是为了绕开打包后 `file://` 页面构造 Worker 的限制。主题 `plmanager-dark` 取 `#1e1f22` 底，关掉 minimap，`tabSize: 4`。标记由主进程的编译结果给：语法错误取 `error.stack` 首行的 `<path>:<line>` 与第三行的插入符列，顶层抛错取堆栈里的 `<path>:line:col`，取不到就退回 1:1。

编辑器只被 `ScriptPage` 引用，而路由本来就是按需加载，所以 Monaco 只在进入「脚本管理」时才进依赖图，不需要再套一层动态 import。

### 3.10 草稿与快捷键

- `dirty` 由「编辑器内容 ≠ 磁盘内容」派生；改动 800ms 防抖写草稿，切脚本/切页面/失焦/关闭前立即 flush。
- 草稿落 `data/drafts.json`（主进程原子写、启动时全量读一次）。不用 localStorage：打包后渲染进程是 `file://`，行为没法在本机沙箱里验证，且仓库约定渲染进程只做界面。
- Ctrl/Cmd+S：页面级 `keydown` + Monaco `addCommand` 兜底；只有保存才写脚本文件。
- 「新增脚本」在内存里造一条临时条目（模板文本就放在 `ScriptPage.vue`），保存成功后才出现文件与行，并删掉临时草稿。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/main/ups/changesets/1.0.1/` | `index.ts`（版本号）+ `preups.ts`（接管旧脚本）+ `dbups.xml`（加列删列）+ `postups.ts`（内置脚本落盘）——见 [升级模块 ups](../design/ups.md) |
| `src/main/ups/changesets/index.ts` | 登记 1.0.1 的三份文件 |
| `src/main/database/sql.ts` / `db.ts` | 脚本语句与 CRUD 重做，`DB_METHODS` 移除脚本项 |
| **新增** `src/main/script/files.ts` / `library.ts` / `ipc.ts` | 3.5 |
| `src/main/script/compile.ts` / `script-service.ts` / `defaults.ts` | 文件名参数与错误解析；执行改走文件；内置判定改为列 |
| `src/main/index.ts` | `initScriptIpc()`；内置落盘接在迁移之后 |
| `src/common/types.ts` / `ipcChannels.ts` | `ProcessScript` 与新类型；`SCRIPT_*` 通道 |
| `src/renderer/db/database.ts` | 移除脚本包装 |
| **新增** `src/renderer/services/script-service.ts` | IPC 薄包装 |
| `src/renderer/views/main/ScriptPage.vue` + **新增** `views/main/scripts/*` | 3.8 |
| `src/renderer/styles/theme.css` | 脚本页局部样式 |
| `docs/SCRIPTING.md` | 改写成文件库语义：文件在哪、怎么加载/新建/保存、编译错误怎么呈现、`__filename` 与相对 `require`、去掉「重载」 |
| `README.md` / `docs/ARCHITECTURE.md` / `docs/TROUBLESHOOTING.md` / `AGENTS.md` / `CHANGELOG.md` | 「源码存在数据库」→「脚本文件在数据目录」；`script/` 职责；数据目录布局；未发布条目 |
| `package.json` | 由使用者执行 `yarn add monaco-editor@^0.55.0`，仓库侧只改清单 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 老库升级丢源码（实测 2 条脚本原文件已不存在） | 接管挂在删列之前，失败即中止升级；用开发库副本预演，逐条比对 `code` 与落盘文件内容 |
| 打包后 `file://` 拒绝外部文件形式的 Worker，Monaco 不可用 | 默认 `?worker&inline`（blob）；仍失败则 `getWorker: () => null`，Monaco 退化成单线程、控制台留一条警告，编辑器本身可用；两者都在 `yarn preview` 的打包产物上确认 |
| Monaco 0.56+ 的 ESM 布局变更 | 固定 `^0.55.0`（0.x 的插入符只允许补丁位）；升级前先复核 `exports` 与 worker 入口 |
| 脚本正文挪到文件后被误删 | 内置按出厂源码重建；普通脚本与库同在数据目录，备份库时会一起备份；文档写明 |
| 每组重新编译的耗时（既有行为） | 本次不改；成为问题再另开方案 |
| `code`/`brief` 残留引用 | 全仓搜一遍；删掉 `ProcessScript.code` 后编译期会兜住大部分 |

## 6. 验证方法

1. 静态检查：`tsc -p tsconfig.node.json`、`vue-tsc -p tsconfig.web.json`、`.vue` 模板编译、控制语句大括号、`node scripts/check-docs.mjs`。
2. 迁移预演：`node .agents/skills/db-maintenance/scripts/verify-migration.mjs`——全新库与现有库两条路径的 `process_script` 列集合都要收敛到 `builtin, created_at, file_path, id, loaded_at, name`。
3. 接管预演：复制开发库到 `dist/`，对副本跑等价逻辑（读 `code` → 写文件 → 改 `file_path`），比对生成文件与 `code` 内容一致、条数为 2（内置那条不参与）。
4. 人工冒烟（Electron 起不来，交给使用者）：`yarn dev` 走一遍第 2 节的 5 条目标，重点看「导入后原文件 mtime 不变」「新增脚本保存前没有新文件」「不按 Ctrl+S 直接重启内容还在」「坏脚本的红标与下拉表变化」；`yarn preview` 的打包产物里确认编辑器可用、控制台没有 `Failed to construct 'Worker'`、安装目录里没有多出脚本文件。
5. 明确未验证：Monaco 在打包 `file://` 下的 worker 行为、Electron 里的实际渲染效果。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 第一版要不要 JS/TS 语言服务（IntelliSense） | 不要：`require` 会被报假错，真错误源是主进程编译。要的话加 `language/typescript/monaco.contribution` + `ts.worker`，并设 `noSemanticValidation: true` |
| 2 | 显示名是否保留扩展名（`default.js`） | 保留（与今天一致）；要统一成 `default` 就在导入时剥扩展名，只影响新导入 |
| 3 | 草稿存 `data/drafts.json` 还是渲染进程 localStorage | 主进程文件：可备份、可排查，符合「渲染只做界面」 |
| 4 | 删除仍被图库引用的脚本：置 NULL / 禁止 | 置 NULL + 确认框显示条数 |
