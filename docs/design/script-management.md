# 脚本管理：用户目录里的脚本文件库、常驻编辑器与脚本分组

**状态**：现行架构
**最后更新**：2026-09-28

---

## 1. 背景

1. **脚本正文曾经只活在库里。** `process_script.code` 是源码的唯一副本，而 `file_path` 指向的文件早已不在（本机开发库 3 条脚本里有 2 条的 `file_path` 指向已删除的 `data/` 目录）；`docs/SCRIPTING.md` 那时还把「源文件丢了也不影响已入库的脚本」当成承诺，界面上能看到的只是源码前 120 字符转义后的摘要。要删掉这一列，就必须先把每一行的源码落成文件。
2. **编译错误是静默的。** 类型检测捕获异常后返回空数组，界面上只表现为「类型」列为空，与「一个已知方法都没导出」的脚本长得一样；导入时中间一份读失败，后面的就不再处理，也不报错。
3. **一行的身份是 `file_path UNIQUE`，内置脚本用空串冒充路径。** 一旦允许「新增脚本」，空串就会撞唯一约束；判断内置也只能靠「路径是否为空」这种隐式约定。
4. **`processed_image.script_id` 没有外键，也没开 `PRAGMA foreign_keys`。** 脚本一删，图库那一列就没有名字来源，只能显示成「手动确认」。
5. **结论**：脚本正文从库里搬到用户目录的 `scripts/`、库里只留索引，编辑、类型检测与未保存草稿都在应用内完成；「先把每一行的源码落成文件、再删列」交给[升级模块 ups](./ups.md) 的版本目录去表达。

### 1.1 修改历史

记录本文档的修订。

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-27 | 首次定稿 | — |
| 2026-09-27 | 补「用户目录 API」：脚本放 `用户目录/scripts/`，不放在 `data/` 下面；路径统一由 `src/main/paths.ts` 派生 | 评审意见 |
| 2026-09-27 | 评审定案：挂 JS 语言服务、显示名去掉扩展名、草稿改成 `temp/scripts/` 一稿一文件、图库内联脚本名快照 | 评审意见 |
| 2026-09-28 | 由路线图迁入 `docs/design/`、正文改成现行架构口径；补上脚本分组（表、拖动换组、搜索与计数） | 路线图只放未实施的方案；分组已在代码里落地 |

---

## 2. 覆盖范围与边界

这套东西今天覆盖：脚本正文的用户目录布局、脚本行与分组的读写、常驻编辑器与它的语言服务、未保存草稿、内置脚本，以及把旧库里那份库内源码搬到文件上的升级步骤。脚本的编写契约（导出什么、能用什么 API）在[脚本编写指南](../SCRIPTING.md)，不在这份文档里。

**明确不做**

- 编译结果缓存与文件监听：不缓存编译结果、不监听文件变化，「改了脚本下一次调用就生效」靠的是每次调用重新读文件并编译。
- 脚本调试器、多标签页编辑器、脚本正文搜索。
- 记录脚本来源路径、「在文件管理器中显示」。
- `.mjs`（ESM）脚本：主进程用 `Module#_compile` 跑 CommonJS，导入对话框只收 `.js`，编辑器语言固定 `javascript`。
- `identify-character` 的调用：类型检测认它，但扫描只调 `identify-structure`、选图只调 `select-image`，框架不调用它。

## 3. 用户目录与目录布局

**用户目录**由 `src/main/paths.ts` 提供，其余路径都从它派生：

| 函数 | 打包态 | 开发态 | 放什么 |
|---|---|---|---|
| `getUserDir()` | `~/.plmanager` | `dist` | 应用全部持久化内容的根 |
| `getDataDir()` | `~/.plmanager/data` | `dist/.plmanager/data` | 库文件与库备份（应用内部数据） |
| `getScriptsDir()` | `~/.plmanager/scripts` | `dist/.plmanager/scripts` | 脚本正文（用户资产） |
| `getTempDir()` | `~/.plmanager/temp` | `dist/.plmanager/temp` | 草稿这类随时可以丢掉的临时状态 |

于是开发态与打包态一一对应：`dist/.plmanager/data` ≙ `~/.plmanager/data`、`dist/.plmanager/scripts` ≙ `~/.plmanager/scripts`。`database/` 与 `ups/` 都从这里取路径。

```
~/.plmanager/                （开发态 dist/.plmanager/）
├── data/
│   ├── picture-lib.db
│   └── backups/             升级前的库备份
├── scripts/<uuid>.js        脚本正文
└── temp/scripts/<key>.json  未保存的编辑草稿
```

两条分类口径：

- **脚本是用户资产，必须在 `scripts/` 而不是 `data/scripts/`**：用户要能一眼看到、能自己备份、能拿别的编辑器打开；库里那份索引坏了也不影响这些文件本身。
- **草稿是临时状态，放 `temp/`**：它随时可以丢，与库、脚本分开存放；用户清理 `temp/` 不会连累任何真实数据。

## 4. 数据模型

`process_script` 今天的列是 `id, name, file_path(UNIQUE), builtin, group_id, loaded_at, created_at`：

- `code` 与 `brief` 已删：正文在文件里，列表不再有源码摘要；
- `builtin` 是真实的 0/1 列（不再靠空串判定），内置那条不能删除，只能「恢复默认」；
- `file_path` 恒为 `scripts/` 下的绝对路径；
- `group_id` 指向 `script_group.id`，`NULL` 就是「未分组」（见第 5 节）。

结构变更写在 `src/main/ups/changesets/1.1.0/dbups.xml` 的 changeSet 里，一条 changeSet 管一张表：

1. `process_script`：加 `builtin` 列并把 `file_path = ''` 的行标为内置；删 `code` 与 `brief`；加 `group_id` 列。
2. `processed_image`：加 `script_name TEXT`（可空），并回填历史行（`UPDATE processed_image SET script_name = (SELECT name FROM process_script WHERE id = processed_image.script_id) WHERE script_id IS NOT NULL`）。图库那一列以后不再 JOIN `process_script`。
3. `script_group`：建分组表，见第 5 节。

`script_name` 的语义要说准：**它是「这个脚本叫什么」的一份副本，不是「选中那一刻它叫什么」的历史名字**——

- 脚本**改名**时跟着改：`renameScript()` 在同一个事务里级联 `UPDATE processed_image SET script_name = ? WHERE script_id = ?`，所以图库永远显示脚本当前的名字，不会出现「我改名了、图库还显示旧名」；
- 脚本**删除**时不改：这份名字就是它留下的最后记录，图库照旧显示得出来——这正是要内联它的原因；
- 改名只有 `renameScript()` 一条路径，真名与副本不会各说各话。

**不加**编译错误列，也不加来源路径列。

`ProcessScript` 视图去掉 `code`/`brief`；`builtin` 给 `boolean`、`groupId` 给 `number | null`（SQLite 存的是 0/1 与可空整数），行原始形态由内部接口承接。

## 5. 脚本分组

### 5.1 表结构与「未分组」

```sql
script_group(id, name, collapsed, created_at)
process_script.group_id  →  script_group.id   -- NULL 就是「未分组」
```

- `name` **允许重复**，靠 `id` 区分，建组时不做查重；`collapsed` 存这个分组的折叠状态。
- **`NULL` 就是「未分组」**：默认分组不占行，因此它没有名字与折叠状态可存——名字写死在界面里（「未分组」），折叠只在这一屏有效，位置恒在最后。
- 这两处结构由 `1.1.0` 的 `dbups.xml` 里两条 changeSet 建立（一条一表），**没有回填**：升级之前没有分组的用法，老数据本来就都是「未分组」。

### 5.2 顺序

具名分组按名称字典序（`localeCompare(name, 'zh')`，在渲染进程排；`SELECT ... ORDER BY id` 只保证顺序稳定，因为 SQL 给不出拼音序），「未分组」固定最后；组内脚本也按字典序。字典序的直接后果：**新建的分组按名字落位，不会默认置顶**，也不需要维护排序字段。

### 5.3 交互

- 组头可折叠。具名分组的折叠状态落库（点击先改本地再写库，失败回滚并弹错）；「未分组」不落库。
- **拖脚本到分组段上就换归属**：HTML5 原生拖拽，没有引入拖拽库；落下只改归属，没有「插到某两行之间」的定位语义——所以分组本身也不能拖动排序。拖动期间在 `document` 上放行 `dragover` 与 `drop`，光标移出列表时不会显示成「禁止」。
- 组头悬停露出「新增脚本 / 加载文件」：「加载文件」把这一组的 id 直接带进 `SCRIPT_IMPORT`；「新增脚本」先把 id 记进那份新草稿（`new-<uuid>` 的可选 `groupId`），Ctrl/Cmd+S 时再由 `SCRIPT_SAVE` 带过去。组头右键是「重命名 / 删除分组」（「未分组」不弹菜单）。
- 顶栏「新建分组」走通用输入窗，预填并全选 `未命名分组`：回车用默认名，直接打字就一次到位。

### 5.4 计数与搜索

- 没有筛选时组头显示组内总数；类型筛选或搜索生效时显示 `可见/总数`。
- 空分组照常显示——刚建的空组否则会像没建成。
- 搜索输入即过滤，判据是**脚本名或它所属分组名**的不区分大小写子串（照 DSH 的会话搜索）；不做脚本正文搜索，那要读每个脚本文件，是另一个量级的活。命中的折叠分组临时展开，不动库里的折叠值。

### 5.5 删除与归属

- 删分组只解散归属：`UPDATE process_script SET group_id = NULL` 与 `DELETE FROM script_group` 在同一个事务里，脚本、正文文件、草稿、图库一律不动。确认框里写明会有几个脚本回到「未分组」。
- 未保存的 `new-` 草稿带一个可选 `groupId`（草稿文件里的字段，缺字段的老草稿当未分组），所以新脚本能先落在某个组下、保存时才写进库；已入库脚本的草稿不存分组——分组在库里，草稿再存一份就是两份真相。拖草稿只重写那一份草稿文件。
- 界面里认不出分组的一律归到「未分组」，所以草稿记着一个已被删掉的组也不会把脚本弄丢。

### 5.6 分工

| 层 | 负责 |
|---|---|
| 渲染进程 | 分组的排序与归位、「未分组」这个虚拟组、拖拽与折叠的即时反馈、按类型与关键字过滤 |
| 主进程 | 分组的行 CRUD、脚本归属的落库、存在性校验（从 IPC 进来的分组 id 一律先过 `ensureScriptGroup()`） |

通道：`SCRIPT_GROUP_LIST` / `CREATE` / `RENAME` / `DELETE` / `COLLAPSE` / `ASSIGN`（`script:group*`）；分组名的输入窗结果走 `SCRIPT_GROUP_CONFIRMED`（带 `groupId` 是改名，不带是新建）；`SCRIPT_IMPORT` 与 `SCRIPT_SAVE` 各多带一个分组参数。归属变更先改本地再落库，失败回滚并弹错。

**明确不动**：扫描、选图等流程选择脚本的下拉仍然只出平铺列表，分组不影响它们。

## 6. 接管旧脚本（`1.1.0/preups.ts`）

在删列之前把 `code` 写成文件。这一步挂在 `preups` 上：一个版本内部的顺序是 preups → dbups → postups，所以它跑的时候列还在。

1. 靠「`process_script` 是否还有 `code` 列」判断要不要接管（`hasScriptCodeColumn()`）——这一列的存在本身就是幂等标记。
2. 跳过 `file_path = ''`（内置，见第 7 节）与已经在 `scripts/` 下的行，防止崩在中间之后重复接管。
3. 逐条原子写 `scripts/<uuid>.js`，再改写该行 `file_path`；顺手把名称里多余的扩展名剥掉（`default.js` → `default`），与导入规则统一。
4. 任一步失败即抛错：升级中止，此时 `code` 列还在，源码不丢。
5. **落盘后再自校验一遍**：重新读 `process_script`，逐行确认 `file_path` 指向真实存在的文件；有任何一行对不上就抛错中止。删列的 dbups 排在同一次升级的后面，所以过不了这一关就永远走不到删列。

## 7. 内置脚本

内置身份由 `builtin` 列决定，源码是随应用发布的 `src/static/default-script.js`（构建时以 `?raw` 内联进主进程，不往安装目录铺文件）。

- 它的行与文件由 `1.1.0` 的 `postups.ts` 建立——那时 `builtin` 列与图库的名字副本都已就位；老库上已经有那一行时，它按出厂源码把文件写出来再回填路径。新库里这一条一开始落在「未分组」，之后可以拖进任意分组。
- 运行期只有 `resetBuiltinScript()`（右键「恢复默认」）会重建它：写回出厂源码、重新分配缺失的文件路径、重测类型、删草稿。**升级之外没有启动时的重建**：内置脚本没有删除入口，文件只可能被使用者在资源管理器里手动删掉，而「恢复默认」正好就是这一种情况的重建路径，于是不为此在每次启动多查一次文件。被删后打开它只会看到「脚本文件不存在」，恢复默认能把它救回来。
- 同一份源码也是「新增脚本」的起始正文，所以改它等于改所有新脚本的起点（`AGENTS.md` 明令不要动它的语义）。

## 8. 主进程分层

| 位置 | 职责 |
|---|---|
| `src/main/paths.ts` | 用户目录 API：`getUserDir()` / `getDataDir()` / `getScriptsDir()` / `getTempDir()` |
| `src/main/script/files.ts` | 文件布局与 IO：`newScriptPath()`（`randomUUID() + '.js'`）、`writeFileAtomic()`（tmp + rename）、读写删脚本文件与草稿；`readScriptSource()` 按 path + mtime + size 缓存读盘结果 |
| `src/main/script/library.ts` | 编排：读取、导入、保存、删除、恢复默认、草稿、分组；`database` 的行与 `files` 的文件在这里合流 |
| `src/main/script/ipc.ts` | 注册 `SCRIPT_*` 通道（`initScriptIpc()`），由 `src/main/index.ts` 的「初始化」加载任务调用，与 `initTaskIpc()` 并列 |
| `src/main/script/compile.ts` | `compileScriptModule(code, filename)`、`inspectScript()`（类型 + 错误）、`detectScriptTypes()`、`describeCompileError()`（消息 + 行列） |
| `src/main/script/script-service.ts` | `executeScript()`：任务运行时用，每次调用重新读文件并编译 |
| `src/main/script/defaults.ts` | 内置脚本的出厂源码 |
| `src/main/database/db.ts` / `sql.ts` | 脚本与分组的行 CRUD、类型关联、图库名字副本的级联；渲染进程经 `DB` 通道取脚本的只有「按类型查」那一条（`getScriptsByType`） |
| `src/renderer/services/script-service.ts` | 渲染进程侧的 `SCRIPT_*` 薄包装 |

脚本的存储与查询归 `database/`（只出「行」），文件与编排归 `script/`；`library.ts` 同时依赖两边，`database/` 不反向依赖 `script/library.ts`。

## 9. 关键流程

- **保存**：名称非空 → 无 id 则生成 `scripts/<uuid>.js` → 原子写文件（**编译失败也照写**）→ 编译得到类型或错误 → 建行或更新 `name`/`loaded_at`（名称变了走 `renameScript()`，由它顺带更新图库里的名字副本）→ 写类型关联 → 删草稿 → 返回 `{ script, compileError }`。分组只在建新行时认一次（新脚本落在草稿预定的那一组）；已入库脚本的归属由 `assignScriptGroup()` 单独改，避免保存时拿界面上的旧状态覆盖刚做的移动。
- **导入**：逐个源路径 try，读源文件 → 复制到 `scripts/<uuid>.js` → 编译检测类型 → 建行（名称取源文件名去掉扩展名），落到调用方给的那一组；失败的收进结果里由界面汇总提示，不静默跳过。
- **读取**：读文件（缺失则空正文 + 「脚本文件不存在」错误）→ 编译并返回错误；**只有内容来自磁盘文件时才更新类型关联**。不变量：类型关联永远描述磁盘上的那一版，草稿只影响显示。
- **删除**：非内置 → 删类型关联、删行、删文件（不存在就忽略）、删草稿。**不动 `processed_image`**：名字副本在最后一次改名时已经同步过，删掉脚本正好让它成为最后一份记录；`script_id` 留作历史引用（悬空无害，AUTOINCREMENT 不复用 id）。确认框先显示受影响的图库条数。
- **恢复默认**：把出厂源码写回内置那条的文件，更新时间戳、重测类型、删草稿。

## 10. IPC

脚本操作自成一组 `SCRIPT_*`（`script:*`），不挂在 `DB` 通道上——它们要读写用户目录里的文件、要管草稿与分组：

| 用途 | 通道 |
|---|---|
| 查询 | `SCRIPT_LIST`、`SCRIPT_LIST_BY_TYPE`、`SCRIPT_READ`、`SCRIPT_CHECK`、`SCRIPT_USAGE` |
| 写入 | `SCRIPT_IMPORT`、`SCRIPT_SAVE`（两者都带分组参数）、`SCRIPT_DELETE`、`SCRIPT_RESET_BUILTIN`、`SCRIPT_RENAME` |
| 草稿 | `SCRIPT_DRAFT_LIST`、`SCRIPT_DRAFT_PUT`、`SCRIPT_DRAFT_DELETE` |
| 原生菜单 | `SCRIPT_MENU`：清单由渲染进程按当前状态给，主进程弹完把点中的动作 id 回过来 |
| 输入窗回发 | `SCRIPT_RENAME_CONFIRMED`（脚本改名）、`SCRIPT_GROUP_CONFIRMED`（带 `groupId` 是改分组名，不带是新建） |
| 分组 | `SCRIPT_GROUP_LIST`、`SCRIPT_GROUP_CREATE`、`SCRIPT_GROUP_RENAME`、`SCRIPT_GROUP_DELETE`、`SCRIPT_GROUP_COLLAPSE`、`SCRIPT_GROUP_ASSIGN` |

扫描与选图按类型挑脚本时不走这一组，而是经 `DB` 通道调 `getScriptsByType`（渲染进程的 `@/db/database` 也只包装了这一条）。草稿 key：已入库脚本 `script-<id>`，新建未保存 `new-<uuid>`。

## 11. 界面

```
┌─ 左栏 300px ─────────────────────────────────────────────┐
│ [全部类型 ▾]   [搜索]   [新建分组]                       │
│                                                          │
│ 📂 分组名 (3)   ← 组头：折叠、计数，悬停露出两个动作按钮 │
│     脚本 A       ← 行：绿=新建未保存，蓝=改过未保存      │
│     脚本 B                                               │
│ 📂 未分组 (1)   ← 恒在最后                               │
│     默认                                                 │
└──────────────────────────────────────────────────────────┘
右栏：常驻的 Monaco 编辑器 + 浮在右上角的编译状态图标 + 底部状态栏
```

- 页面上**没有名称输入框，也没有「保存 / 放弃修改」按钮**：保存只有 Ctrl/Cmd+S（页面级 `keydown` 与 Monaco 命令各一份）；改名、放弃修改、恢复默认、删除、分组操作都在原生右键菜单里。
- 左栏顶部三个控件：类型筛选（原生浮窗多选，勾完不关窗）、搜索（点图标从 0 宽展开，输入即过滤）、新建分组。
- 组头与行的样子见上图；名称就是状态色，照 IDEA 的 git 状态色：新建未保存绿、改过未保存蓝、干净用默认色。
- 右栏 `ScriptEditor.vue` = 编辑器 + 右上角状态图标（没问题绿勾、有问题红叹号，细节走 tooltip）+ 底部状态栏（左边是检测到的导出类型，右边是光标/选区、行结束符与缩进、问题数）。
- 改名与分组名都走通用输入窗（`src/renderer/views/dialogs/PromptDialog.vue`）；确认与报错一律用原生窗口（`confirmDialog()` / `alertDialog()`），不用浏览器的 `confirm()`，也不用 `ElMessageBox`。
- 页面横向不内缩，代码区尽量宽。

## 12. 编辑器与语言服务（Monaco 0.57）

`monaco-editor` 的版本是 `^0.57.0`，它的 `exports` 把 `./*` 映射到 `./esm/vs/*.js`，于是：

- 深导入**省掉 `esm/vs` 前缀**：`monaco-editor/editor/editor.worker`；
- **不用手动引 CSS**：样式由包自己的模块 import 进来，Vite 会打进页面样式；
- 入口用裸包名 `import * as monaco from 'monaco-editor'`：注册全部语言定义与 JS/TS 语言服务，并把语言服务另导出成 `typescript`。

```ts
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker&inline';
```

worker 由 `MonacoEnvironment.getWorker` 决定：`javascript` 与 `typescript` 用 `ts.worker`，其余语言退回编辑器 worker。两者都走 inline（blob），为的是绕开打包后 `file://` 页面构造 Worker 的限制。Monaco 的 JS/TS 是**同一个 worker**，没有单独的 JS worker。

**语言服务的挂载点在 0.57 变了**：`monaco.languages.typescript` 只剩一个 deprecated 壳，整套语言服务（`javascriptDefaults`、`ScriptTarget`、`ModuleKind`、`getJavaScriptWorker()`）挂在包根的 `typescript` 导出上。只配 JS 一侧、不碰 `typescriptDefaults`：

```ts
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,      // require('sharp') 这类解析不到的模块不该报假错
  noSyntaxValidation: false,       // 语法错误照常实时标出来
  noSuggestionDiagnostics: true,   // 80001「可以转成 ES 模块」对 CJS 脚本是错的
});
monaco.typescript.javascriptDefaults.setCompilerOptions({
  allowJs: true, allowNonTsExtensions: true,
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.CommonJS,
});
monaco.typescript.javascriptDefaults.addExtraLib(CJS_GLOBALS, 'plmanager-cjs.d.ts');
```

`CJS_GLOBALS` 声明 `require` / `module` / `exports` / `__filename` / `__dirname`——补全与悬停因此可用（**IntelliSense 是现状**，关掉语义校验只是不报假错）。主题 `plmanager-dark` 取 `#1e1f22` 底；编辑器选项：`automaticLayout`、关 minimap、`fontSize: 14`、`tabSize: 4`、`scrollBeyondLastLine`、`smoothScrolling`、`fixedOverflowWidgets`、`contextmenu: false`（右键一律走原生菜单）、`lineDecorationsWidth: 14`、`rulers: [120]`、`stickyScroll: { enabled: true, maxLineCount: 3 }`。

`monaco-env.ts` 里还有 `warmUpTypeScript()`：加载服务「脚本编辑器」预热任务的第二步，用一个一次性离屏编辑器把语言服务点着（为什么必须是一个挂进编辑器的模型、以及它常驻堆内存的代价，见 [loading.md](./loading.md)）。编辑器只被 `ScriptPage` 引用，路由按需加载，所以 Monaco 只在进入脚本管理时才进依赖图。

## 13. 标记、改动色条与状态

- **一份文档一个 model**（key 是 `script-<id>` 与 `new-<uuid>`）：切脚本只换 model，撤销历史与光标按 model 保留；新建脚本第一次保存后 key 从 `new-` 变成 `script-`、内容一个字没动，那种情况沿用同一个 model，撤销历史不因保存而断。
- **编译错误**：主进程给的 `{ message, line, column }` 转成 Monaco marker（行列取不到退回 1:1），并把出错那一行整行淡红；不把视口弹到出错行——那一行有整行染色与概览标尺，找得到。
- **「自上次保存改了哪里」**：`diff.ts` 的 `diffLineChanges()` 在渲染进程按行做差分，做成计算属性——正文一变就重算，色条跟手，既不需要防抖也不会算出过期结果。先剪掉公共前后缀，剩下的跑 Myers 最短编辑脚本，编辑距离上限 500（实测 3000 行隔行改写约 14ms，上限放宽到 2000 要 75ms）；新增与修改在行号右侧那条窄带上画色条、在概览标尺上打点，纯删除画一个小三角。还没落盘的 `new-` 草稿没有可比的一版，不画。
- **状态两处**：编辑区右上角常驻一个状态图标（IDEA 那种 widget，没问题绿勾、有问题红叹号），底部状态栏左边是检测到的导出类型、右边是光标/选区、行结束符与缩进、问题数。问题数合并两个来源——Monaco 自己的实时诊断与主进程的编译错误；同一个语法错误两边都会报，Monaco 已经报了就不再累加，于是改好之后立刻归零。

## 14. 草稿与快捷键

- `dirty` 由「编辑器内容 ≠ 磁盘内容」派生；**只有脏的脚本才写草稿**。
- 草稿**一稿一文件**：`temp/scripts/<key>.json`，形状是 `{ name, code, groupId, updatedAt }`，原子写。分组只跟着 `new-` 草稿走（见第 5 节）。相比「一份 `drafts.json` 装全部」，它每次只重写改动的那一份，某一份坏了也不牵连其它。
- 防抖 **1 秒**；切脚本、切页面、失焦、卸载前立即结算。
- 进脚本页时清理孤儿：`temp/scripts/` 里 `script-<id>` 指向的脚本已经不存在的一律删掉；`new-*` 的草稿保留（库里本来就没有它的行）。
- 不用 localStorage：打包后渲染进程是 `file://`，且仓库约定渲染进程只做界面。
- 「新增脚本」在内存里造一条临时条目（起始正文就是内置脚本的源码），立刻落一份草稿并查一遍状态；保存成功后才生成文件与行，key 换成 `script-<id>`。删除一份没保存过的脚本，删的就是那份草稿。
- Ctrl/Cmd+S：页面级 `keydown` 与 Monaco `addCommand` 各一份；保存或放弃后删掉那份草稿。

## 15. 改动时的检查点

- 动保存、检查、读取任何一处，先确认**类型关联永远描述磁盘上的那一版**：草稿的类型不能被写进 `script_type`。
- 动改名路径，先确认 `processed_image.script_name` 的级联——改名只有 `renameScript()` 那条路（脚本行与图库副本在同一个事务里），绕过它写名就会让图库显示旧名。
- 动分组，先确认 `group_id` 只可能是 `null`（未分组）或 `script_group` 里存在的 id；删分组必须在同一个事务里把成员置空，从 IPC 进来的分组 id 一律先过 `ensureScriptGroup()`。
- 动草稿，先确认 key 的两种形态（`script-<id>` 与 `new-<uuid>`）：`new-` 的草稿不参与孤儿清理，也不当成已入库脚本处理。
- 动 `process_script` 的列或 `1.1.0` 的脚本，注意三段顺序：`preups` 在 `dbups.xml` 之前、`postups` 在之后；接管的幂等标记是「`code` 列还在不在」，落盘自校验过不了就绝不能走到删列那一条。
- 动迁移前先看 [ups.md](./ups.md) 的记账规则：身份是 `(author, id, filename)`，**改了已经执行过的 changeSet 不会生效**；预演要覆盖全新库与现有库两条路径。
- 改编辑器就注意 0.57 的三处：语言服务在包根的 `typescript` 上（不是 `monaco.languages.typescript`）、深导入不写 `esm/vs` 前缀、worker 必须 inline。
- 渲染进程不直接读文件：脚本正文与草稿一律走 `SCRIPT_*` 通道。

静态检查与迁移预演的命令见 [AGENTS.md](../../AGENTS.md) 的「改完必须自检」。

## 16. 已知取舍

| 取舍 | 代价 |
|---|---|
| 正文放用户目录的 `scripts/`，库里只留索引 | 文件被外部删掉时脚本就没有正文，只能看到「脚本文件不存在」；备份要连用户目录一起备 |
| 每次调用重新读文件并编译 | 每个图片组都要编译一次，脚本顶层代码做的事会重复发生；读盘那一层虽按 path + mtime + size 缓存，编译结果不缓存 |
| worker 用 `?worker&inline` | 两个 worker 以 base64 内联进页面 chunk，脚本页 chunk 因此十几 MB；换来的是打包后 `file://` 页面里 Worker 能用 |
| 预热把 Monaco 与 TS 语言服务常驻渲染进程 | 从不打开脚本页也占一块堆内存（见 [loading.md](./loading.md) 的取舍表） |
| 分组名允许重复 | 同一个名字可以有好几个分组，只能靠位置与内容区分，也可以建一个和默认分组同名的具名分组 |
| 「未分组」不占行 | 它没有名字与折叠状态可存：名字写死在界面里，折叠只在本次停留期间有效 |
| 新建分组按字典序落位 | 不能把常用分组钉在最上面，要调位置只能改名 |
| 拖拽是移动脚本的唯一入口 | 没有等价的键盘或菜单入口，落点也只有分组段（分不出「插到哪两行之间」） |
| 分组只作用于脚本页 | 扫描与选图的下拉仍是平铺列表，按类型挑脚本时看不到分组 |
| 图库内联的 `script_name` 是副本 | 改名必须在同一个事务里级联更新，绕过 `renameScript()` 写名就会让副本失真 |
