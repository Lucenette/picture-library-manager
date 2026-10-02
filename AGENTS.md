# AGENTS.md

给在本仓库工作的编码代理（AI 或人类）的约定。**动手前请先读完这一份。**

---

## 项目速览

- **是什么**：Electron 桌面应用，扫描来源各异的图库目录、批量选图、导出到统一目录。
- **技术栈**：Electron 44 + Vue 3 + TypeScript 5 + Vite 6 + Element Plus 2 + node:sqlite（Electron 内置 SQLite）+ sharp（图片解码）。
- **分支**：`develop`。提交信息用中文，形如 `范围：做了什么`（如 `对话框原生化：PromptDialog + FileViewerDialog`）。
- **数据目录**：开发态是项目的 `dist/`，打包后是用户主目录的 `~/.plmanager/`（Windows 为 `C:\Users\<用户名>\.plmanager`），里面分四份：`data/` 放数据库与库备份（`data/picture-lib.db`）、`scripts/` 放脚本正文（一份脚本一个 `.js` 文件）、`temp/` 放编辑草稿、`logs/` 放三个日志文件（`root.log` / `external.log` / `script.log`，位置与读法见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 的「日志」一节）。**用户数据不放安装目录**：Windows 的覆盖安装会先跑旧版卸载器清空整个安装目录，Linux 的 deb 装在 root 所有的 `/opt/PLManager`，macOS 的 exe 在 `.app` 内部。

## 常用命令

| 命令 | 作用 | 备注 |
|---|---|---|
| `yarn dev` | 启动开发环境 | 主进程/preload 由 electron-vite 构建，渲染进程走 Vite |
| `yarn typecheck` | `tsc`（主进程与 `common`）+ `vue-tsc`（渲染进程，含 `.vue`） | **`.vue` 的类型错误只有 `vue-tsc` 能发现**，只跑 `tsc` 会漏 |
| `yarn icon` | 从 `src/static/icon.png` 生成全平台图标到 `dist/icons` | electron-icon-builder；`build` 已串在它之后 |
| `yarn build` | 打包**当前平台**（Windows → NSIS，macOS → dmg，Linux → AppImage / deb） | 产物在 `dist/`；指定平台用 `yarn build:win` / `build:mac` / `build:linux` |
| `yarn preview` | 构建后启动 Electron，预览**生产产物**（不打包） | 它自己会先构建；要跳过用 `yarn preview --skipBuild` |
| `node scripts/check-docs.mjs` | 文档检查：编码、相对链接与锚点、README 索引、skill frontmatter、占位符 | 零依赖；CI 与「改完必须自检」都会跑 |
| `node scripts/make-fixture.mjs` | 生成样例图库到 `dist/fixture/` | 零依赖、可重复执行；见 `CONTRIBUTING.md` 的「样例图库」 |
| `node scripts/check-code.mjs` | 代码规范检查：命名空间导入、控制语句大括号、渲染进程 Node 边界、`database` 反向依赖 | 用现有 `typescript` 与 `@vue/compiler-sfc`，需先 `yarn install` |

---

## 动手前的边界

**涉及新增、移动、改名文件或目录，先给出方案并等待明确答复，不要自行决定。**

这个仓库的目录结构是讨论后定下来的，改一处会牵动 README、大量 import 与构建配置。问一句的成本远低于返工。

---

## 分层规则

| 目录 | 放什么 | 不放什么 |
|---|---|---|
| `src/common/` | **主进程与渲染进程都在用**的契约（类型、IPC 通道名） | 只被单进程使用的模块——放回该进程目录 |
| `src/main/image/` | 图片处理流水线：目录遍历 + 解码线程池 | 业务语义（任务、进度、图库概念） |
| `src/main/task/` | 后台任务的编排：队列、状态机、runner | 具体的重计算（交给 `image/` 的线程） |
| `src/main/ups/` | **升级模块**：版本目录（`preups.ts` / `dbups.xml` / `postups.ts`）、引擎；作为加载服务的一项任务运行，调用 `database/` 跑 SQL 与读写账本 | 反向依赖业务模块；把升级塞回启动流程或 `database/` |
| `src/main/loading/` | **加载服务**：启动阶段任务的登记与调度（谁阻塞、谁可以预热、跑在哪个进程）、加载页状态与跨进程下发 | 具体任务本身——升级在 `ups/`、预热在渲染进程入口；把业务逻辑写进调度 |
| `src/main/database/` | 开库（没有就建文件）、CRUD、账本读写、DB 的 IPC 调度；`sort/` 子目录把文本算成可比较的排序键（见 [docs/design/sort-keys.md](docs/design/sort-keys.md)） | 升级的编排与版本目录——那是 `ups/` 的事；建表语句——写进 `ups/changesets/<版本>/dbups.xml` |
| `src/main/dialogs/` | **自己创建 `BrowserWindow`** 的模块 | 不持有窗口的 IPC——跟业务模块放一起 |
| `src/main/script/` | 脚本文件与草稿的落盘（用户目录的 `scripts/`、`temp/scripts/`）、编译与调用 | SQL 与表结构——那是 `database/` 的事 |
| `src/renderer/` | 界面、状态、IPC 包装 | **任何 Node 内置模块或 Node 专属依赖**（`electron` 的 `ipcRenderer` 除外） |
| `src/renderer/loading/` | 加载服务的渲染进程侧：状态引用、按 id 认领任务、回执、报告就绪 | 任务清单与调度——那在主进程 |
| `src/renderer/entries/` | **每个窗口类的入口**（`main` / `dialogs` / `viewer` / `popup`）；共用引导在 `entries/shell/`：`page.ts`（`mountPage`，只依赖 `vue`）、`window-chrome.ts`（平台类 + 失焦标记）、`element-plus.ts`（唯一引组件库的地方）、`first-paint.ts`（构建期片段） | 入口自己 import 组件库或 `App.vue`；`shell/page.ts` 不许引 Element Plus，否则小入口又背上整个组件库 |
| `src/static/` | 构建资源：应用图标、内置默认脚本源码等**只当资源用**的静态文件（图标由 `yarn icon` 生成到 `dist/icons`） | 可执行的主进程 / 渲染进程模块——代码放 `main/`、`renderer/`、`common/`；这里的文件只能以 `?raw` 这类资源方式引入 |
| `docs/` | 设计说明、不变量、排障；**已落地**的子系统说明放 `docs/design/` | 尚未实施的方案——放进 `docs/roadmap/` |

判断口径：**按职责归类，不按"谁在用我"归类。** 一个模块只有一个调用方，不构成把它塞进调用方目录的理由（`database` 也只被少数模块用，但它独立存在）。

---

## 文档与状态

- 设计说明、不变量与排障写在 `docs/`；**尚未实施的方案写在 `docs/roadmap/`**，一个功能一个文件（kebab-case），状态取值见该目录的 README。
- 文档写**为什么**与**约束**，不重抄代码已经表达清楚的"怎么做"。
- 各层文档的边界与归属见 `docs/README.md`；新增或修订文档前先在那里找到位置。
- 方案落地后更新 roadmap 中对应文件的状态并补上提交号，再用 `git mv` 把它挪到 `docs/design/` 作为该子系统的
  设计说明——**不要删除文件**，也不要让它留在路线图里冒充未完成事项。
- AI 或工具的临时工作状态（待办清单、缓存、会话记录）**不进版本库**，放各自的工具目录并由 `.gitignore` 忽略。

---

## 硬性代码规范

### 1. 禁止命名空间导入

```ts
// ❌
import * as db from '@/database/db';
export * from './types';

// ✅
import { getAllGalleries, insertTask } from '@/database/db';
```

### 2. 控制语句必须带大括号

`if` / `else` / `for` / `for-in` / `for-of` / `while` / `do-while` 一律如此，**即使只有一行**。`} else {` 写在同一行。

```ts
// ❌
if (!task) return;
if (status === 'processed') return 'success';
for (const ddl of DDL_ALL) db.run(ddl);

// ✅
if (!task) {
  return;
}
if (status === 'processed') {
  return 'success';
}
for (const ddl of DDL_ALL) {
  db.run(ddl);
}
```

### 3. 导入顺序

Node 内置 → 第三方 → `@common/` → `@/`（本进程内部，`@/` 在主进程指向 `src/main`，在渲染进程指向 `src/renderer`）。组之间空一行，组内按名称排序。

### 4. 注释与 JSDoc

- 一律用**中文**。
- 导出的符号必须有说明；`@param` / `@returns` 只在签名本身说不清时才写。
- 不复述函数名，不写"这是一个获取数据的函数"这类废话。
- 私有小工具只在"为什么这么写"不明显时注释；注释的价值在于解释**意图与约束**，不是翻译代码。

### 5. 文件内顺序

`常量 → 类型 → 模块状态 → 派生（计算属性）→ 生命周期 → 方法 → 内部工具`

`.vue` 里先 `<template>`，再 `<script setup lang="ts">`，最后 `<style scoped>`；`script` 内部按上面的顺序，且在 setup 里先声明状态、再写引用它们的计算属性。

### 6. 不留死代码

这三类必须清掉：零引用的导出、没有任何 import 者的文件、只有一处实现且无人引用的接口。

```ts
// ❌ 内部步骤却对外导出
export function upsertScript(...) {}

// ✅ 只在本文件使用就不导出
function upsertScript(...) {}
```

例外：某个工具模块的**对外能力**即使当前只在模块内使用也保留导出（如 `window-manager` 的 `create` / `getId` / `close`——它们就是这个模块存在的意义）。

---

## 运行时约定

### 1. 渲染进程只做界面

渲染进程**不得**出现 `fs` / `path` / `crypto` / `jimp` / `image-size` 或图像解码器。需要文件读取、批量写库、脚本执行的工作一律放主进程。

唯一例外是 `electron` 本身（`ipcRenderer` 等）：本项目渲染进程启用了 `nodeIntegration`、关闭了上下文隔离，全部 IPC 直接引用 `electron`。这是既有设计，不算违规；静态检查时把它与真正的 Node 内置模块区分开。

### 2. 主进程不许长时间霸占主线程

主进程就是浏览器的 browser process：窗口拖动、新建窗口、与渲染进程的合成 IPC 都依赖它的事件循环。
它一旦被占住，界面立刻表现为卡顿（此时渲染进程本身可能仍然流畅）。因此：

- **I/O 一律用异步 API**（`fs.promises.*`，等待发生在 libuv 线程池）。**不要用 `readdirSync` / `statSync` / `copyFileSync` / `readFileSync` 这类同步版本**：在网络盘（SMB）上每次调用都是一次网络往返，
  单次就可能几十毫秒，而 `setImmediate` 分片救不了同步调用——调用没返回，事件循环就没有机会跑。
  实测症状：遍历网络图库时 CPU 接近 0、网络占满、窗口拖动卡死。
- 长循环必须分片并周期性让出事件循环（`await setImmediate`），见 `image/walk.ts` 的 `step()`。
- **单次不可打断的重计算必须走工作线程**，见 `image/thumbnail-pool.ts`（`?nodeWorker` + `worker_threads`）。
- 判断标准：一次调用若可能持续几十毫秒以上且中途无法让出（无论 CPU 还是 I/O），就别放主线程。

### 3. 数据库：事务只用于原子性

存储是 Electron 内置的 `node:sqlite`（真实文件 + WAL），单条写入只追加日志，毫秒级完成。
因此：

- **`beginBatch()` / `endBatch()` 只用来表达"要么全做、要么全不做"**（例如"清空图库 + 写入新数据"），
  不再需要为了减少落盘次数而攒批。
- **逐单元提交是允许且鼓励的**：扫描现在是"一张图一条 INSERT、写一张落一张"，取消或崩溃都不会丢掉已完成的部分。
- 不要手写落盘：sql.js 时代那套"整库导出 + 原子替换"（`persist()`、`writeFileAtomic`）已随迁移删除。

### 4. 新增 IPC 的归属

- 需要创建窗口的 → `src/main/dialogs/`，并在 `dialogs/index.ts` 注册。
- 不需要窗口的 → 跟业务模块放一起（如 `task/ipc.ts` / `script/ipc.ts`），由各自模块的 `initXxx()` 注册；**启动阶段要跑的事登记给加载服务**（见第 8 节）。

### 5. 弹窗一律用原生窗口

不要用浏览器的 `confirm()` / `alert()`，也不要用 Element Plus 的 `ElMessageBox`——它们渲染在
主窗口内部，跟项目其它弹窗不一致。统一走 `@/services/dialog-service` 的 `confirmDialog()` /
`alertDialog()`，对应的原生窗口是 `main/dialogs/confirm.ts` + `views/dialogs/ConfirmDialog.vue`。

新增弹窗时照 `prompt.ts` / `confirm.ts` 的模式：主进程建一个无边框子窗口，渲染进程出对应的
`.vue` 页面，结果由主进程转交给发起方。

### 6. 共享层的准入

只有**两个进程都在用**的东西才能进 `src/common/`。曾经出现过 `common/script.ts`、`common/image.ts` 只被主进程使用的错误，已被移回。

### 7. 任务系统的不变量

改动任务相关代码前，先确认以下几条不被破坏：

- **状态变化推送整张列表**（`task:changed` 携带排好序的完整列表），渲染进程整表替换、不自行插入；
  高频进度只发 `{ id, progress, message }` 就地打补丁（`task:progress`）。顺序的唯一来源是主进程。
  曾经的实现让渲染进程把新任务插到列表末尾，导致顺序漂移与"卡在识别中"。
- **任务列表的订阅挂在模块上**（`useTasks.ts`），不要改成页面级的 `useIpcListener`：那样它会跟着第一个调用它的页面一起注销，
  而 `subscribed` 守卫不会再订阅一次——切换页面之后整个窗口的任务列表就不再更新（表现为「任务一直卡在 5%」）。
  页面自己订阅 `task:changed` 时，收到的是**整张列表**，要按 id 找自己那条，不要按单条任务写判断。
- **提交命令额外返回新任务 id**（`TaskSubmitResult`）：它是唯一带额外返回值的命令，调用方不应去列表里猜。
- **取消与强制结束必须经 `ctx.onAbort(...)` 立刻释放资源**（线程池、句柄），不能等 runner 走到下一个检查点：
  worker 线程会阻止主进程退出，等待检查点会让"关窗不退出"复发。
- 进度写库节流到不低于 1 秒；任务成功结束时进度记为 100%。
- 新增一种任务照 `docs/ARCHITECTURE.md` 末尾的五步配方；runner 只在单元边界调用 `ctx.checkpoint()`。

### 8. 升级模块与版本目录

- 升级独立成 `src/main/ups/`，`src/main/database/` 是它的下层：升级模块调用数据库模块跑 SQL、读写账本，
  **`database/` 里不出现 `@/ups`**。
- 一个版本 = `src/main/ups/changesets/<package.json 的版本号>/` 一个目录，最多三件东西：
  `preups.ts`（SQL 之前跑）、`dbups.xml`（`<changeSet>`）、`postups.ts`（SQL 之后跑），缺哪个就跳过哪个。
  目录里的 `index.ts` 写死 `VERSION` 并导出 `changelog`——**版本号以代码里的常量为准，目录名只给人看**；
  外层 `changesets/index.ts` 只 import 各版本目录的 `index.ts`。清单里出现相同版本号直接抛错。
- 建表语句不进代码，写进 `dbups.xml` 的 `<changeSet>` 里，一条用 `<comment>` 说明它做了什么。
- **账本按身份记账、执行过的不再执行**：changeSet 是 `(author, id, filename)`（`id` 用 20 位定长数字时间戳），
  脚本是 `(script, 'preups' | 'postups', 版本号)`。**已发布版本的目录冻结**：改一条已执行的 changeset 或脚本
  都不会生效，要重跑得先删掉 `schema_migration` 里那一行。账本表由引擎用代码创建，不要写进 changelog。
- 升级脚本是普通模块（可以 import 任何东西），但：一律异步 IO；不要自己写 `BEGIN` / `COMMIT`；
  不要吞异常（抛错才回滚，脚本写进库的东西随事务一起不留）；**文件操作不受事务保护**，
  要改或删已有文件就自己先备份，并保证重复执行是安全的。
- 启动顺序固定：`initDatabase()`（开库 + DB 通道）→ 升级 → 其余初始化。三者都是**加载服务**
  （`src/main/loading/`，见 [docs/design/loading.md](docs/design/loading.md)）里的任务：升级与其余初始化
  都是 `essential`，按登记顺序串行。加载服务的终态在所有 `essential` 任务之后才公布，因此
  「加载页收到终态时通道必然已经注册好了」是登记表的结论，不再需要额外的时序约定。
- 启动阶段的活一律 `registerLoadTask()` 登记，不要写在 `startLoading()` 之后。`essential` 跑完才进主界面、
  失败即整轮失败；`warmup` 与必须的任务并行、跑完不放行、失败只记日志。渲染进程的预热用
  `target: 'renderer'` 登记，id 加在 `common/ipcChannels.ts` 的 `LOAD_TASK` 里，实现写在渲染进程入口。
- **破坏性结构变更（删列、删表、改名）之前，先在 preups 里把要保留的数据落成文件并自校验**：列一旦丢掉，
  除了升级前的库备份之外没有第二份副本，而备份是整库回滚、不能只捞回一个字段。落盘放在 SQL 之前、校验放在同一段脚本末尾，
  任一步失败就中止整轮升级——那时列还在。
- 转义由写的人负责：`<sql>` 里出现 `<` 写成 `&lt;`（漏写可能被 XML 当成标签吞掉），`&` 写成 `&amp;`。
- 需要图片解码的补数据仍归任务系统，不要塞进 changeSet。

### 9. 自绘标题栏

主窗口没有系统标题栏，**单独一条 `.title-bar`（40px）就是它**，导航是它下面**左侧**那条 40px 竖栏（`.app-rail`）；**系统窗口按钮保留**：
Windows / Linux 靠 `titleBarOverlay`（Window Controls Overlay），macOS 靠原生红绿灯。
Windows / Linux 的左端是 40×40 图标槽（图标 16×16），**macOS 不画这个槽**（左端归红绿灯，只留标题文字）。
改这条栏时几条一起看：

- 主窗口骨架（`.app-container` / `.title-bar` / `.app-body` / `.app-rail` / `.app-main`）一律用普通 `div`，
  **不要用 `el-container` / `el-main`**：Element Plus 的 `.el-container{flex-direction:row}` 与 `.app-container` 同权重，
  胜负只看样式表注入顺序，一旦它排在后面整页就横过来（标题栏缩成左侧一条、导航栏跑到窗口中间）。
- `.title-bar` 是拖拽区，左侧导航栏不是；要在标题栏里放可点元素就得补 `no-drag`，否则表现为「点不动」。
- `--title-bar-height`（CSS）与 `createMain()` 的 `titleBar.height` 必须相等；
  `titleBar.color` 要与 `.title-bar` 的底色一致。
- 系统按钮占的位置由 `env(titlebar-area-*)` 让出；macOS 没有 WCO，靠 `html.platform-mac` 补左内边距。
- **失焦时整条 chrome 要一起压暗**（标题栏的图标与文字、左侧导航栏的图标）：渲染进程挂
  `html.window-blurred`（DOM focus / blur），主进程换 `setTitleBarOverlay` 的字形色——
  两端都挂在同一个窗口焦点事件上，别只改一边。

细节与取舍见 [docs/design/window-management.md](docs/design/window-management.md)。

### 10. 日志

- **一律用封装，不直接 `console.*`**：主进程 `import { createLogger } from '@/log'`、渲染进程 `import { createLogger } from '@/services/log-service'`，
  一个模块一个 logger（category 为 `main.<模块>` / `renderer.<模块>`，模块名自取、能认出是哪个文件）。直接 `console.*` 会被 stdout 补丁当成第三方输出记进 `external.log`，来源与级别都是错的。
- 消息用模板字符串就地拼好：`log.warn(`failed to open file: ${path}`)`；要附带错误对象时作为第二个参数传入（`log.error(msg, error)`，Error 记栈、对象记 JSON），**不要用占位符**。
- **日志消息一律英文 ASCII**，只有变量值（路径、脚本名、任务标题）可以是中文。Windows 终端默认 GBK 而 Node 按 UTF-8 输出，中文消息在终端里就是乱码，文件与终端之间也没有两边都对的编码。
- **异常消息按去向定语言**：会进日志的用英文——任务失败、加载失败、升级校验与升级脚本、脚本执行、DB 打不开都会作为 `cause` 落进 `root.log`；不会进日志的纯界面文案（任务状态词、输入校验、对话框标题、进度标题）保持中文。
- **关键节点用 `info` 落盘**：启动与退出、窗口开关、开库、加载任务的开始与结束、升级步骤、任务的提交与终态、各 runner 的汇总。文件侧只收 INFO 及以上，写成 `debug` 等于只在控制台可见。
- worker 线程（`image/` 里的解码）够不着日志文件、也没有 electron：它不写日志，失败靠返回值交给调用方记录。
- 三个文件在哪、级别怎么调，见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) 的「日志」一节；不变量与改动注意点见 [docs/design/logging.md](docs/design/logging.md)。

---

## 已知环境限制

- **`yarn build` 可能无法在受限沙箱里跑完**：esbuild 需要 `spawn` 子进程并用命名管道通信，沙箱会以 `spawn EPERM` 拒绝。遇到时如实说明"构建未验证"，不要假装通过，也不要绕过沙箱。
- **`vue-tsc` 已随依赖安装**（当前 5.9.3）：`tsc` 只覆盖主进程与 `common`，**`.vue` 的类型错误必须靠 `vue-tsc`**。
  只跑 `tsc` 就宣称"类型已检查"是错的——曾经因此漏掉一个缺失的 import，对应按钮一点就报 `ReferenceError`。
- **Electron ≥ 42 不再在 install 时下载二进制**：官方的 `postinstall` 没了，改成首次运行 `electron .` 时按需拉取。
  本仓库在 `package.json` 的 `postinstall` 里显式跑 `node node_modules/electron/install.js`（幂等，装过就跳过），
  让 `yarn install` 之后直接就能开发。GitHub 拉不动时用环境变量 `ELECTRON_MIRROR` 指镜像——
  别再往 `.npmrc` 写 `electron_mirror`，npm 已警告这类未知配置下个大版本会失效。
- **Windows 终端中文乱码**：默认 GBK 代码页，Node 按 UTF-8 输出，中文在终端显示为乱码；`chcp 65001` 后正常，文件内容不受影响。应用自己写出的日志消息已改成英文（见运行时约定第 10 节），仍会乱码的是第三方库自己打的中文。
- **不要清空 `dist/`（例如 `rimraf dist`）**：开发态数据库就在 `dist/data/picture-lib.db`，是你自己的图库
  （实测 103 MB、25066 条记录）。删掉不会有任何报错、构建照样成功，只是数据没了，而且 `dist/` 被 `.gitignore` 忽略、没法从 git 找回。
  要清理只点具体产物：`dist/icons`、`dist/win-unpacked`、`dist/*.exe`、`dist/*.yml`。
- **依赖可复现**：`yarn.lock` 已入库，CI 用 `yarn install --frozen-lockfile` 安装；Node 版本由 `.nvmrc`（`22`）与 `package.json` 的 `engines.node`（`>=22.12`）固定。
- **`?nodeWorker` 是 electron-vite 的虚拟模块**：静态的"导入路径是否存在"检查工具会把它报成无法解析，这是正常的，不是错误。
- **`ReplaceFileW EIO (Win32 32)`**：`yarn dev` 或 IDE 正在占用该文件，稍后重试即可。

---

## 改完必须自检

提交前至少做到：

1. `node_modules/.bin/tsc -p tsconfig.node.json` —— 覆盖主进程与 `common`。
2. `node_modules/.bin/vue-tsc -p tsconfig.web.json` —— 覆盖渲染进程，**含 `.vue`**。
   这一步不能省：`tsc` 看不到 `.vue`，缺 import、模板变量不存在这类错误只有它会报。
3. `.vue` 的模板编译：用 `@vue/compiler-sfc` 的 `parse` + `compileScript` + `compileTemplate` 逐个编译。
4. 控制语句大括号：用 `typescript` 的 AST 遍历 `IfStatement` / `ForStatement` / `ForInStatement` / `ForOfStatement` / `WhileStatement` / `DoStatement`，检查语句体是否为 `Block`。
5. 导入解析：确认所有 `@/`、`@common/` 与相对路径都能落到真实文件（`?nodeWorker`、`?raw` 除外——
   它们由 electron-vite / Vite 接管）。
6. 渲染进程不得引用 Node 模块（见上面第 1 条约定）。
7. `node scripts/check-docs.mjs` —— 覆盖编码（Markdown 与 changelog XML）、文档的相对链接与锚点、`docs/roadmap` 与 `docs/design` 的 README 索引、skill 的 frontmatter。
8. `node scripts/check-code.mjs` —— 覆盖禁止命名空间导入（硬性规范 1）、控制语句大括号（硬性规范 2）、渲染进程引用 Node 内置模块（运行时约定 1）、`src/main/database/` 依赖 `@/ups`（运行时约定 8）。

改动涉及运行时行为时（尤其是新起的窗口、worker、IPC 通道），**静态检查通过不等于功能正常**，要在回复里明确说清哪些是"已验证"、哪些需要使用者手动冒烟。

---

## 明确不要做的事

- 不要擅自 `git commit` / `git push`，除非明确要求。
- 不要顺手改动目录结构或文件位置（见开头"动手前的边界"）。
- 不要改动 `src/static/default-script.js`（内置默认脚本）的语义：它随应用发布，改了等于改所有新库的默认行为。
- **不要改动 `package.json`、不要自行安装或卸载依赖**（包括 `yarn add`）：需要新依赖时说明理由与命令，等使用者执行。
- **不要结束进程、不要改系统状态**（杀他人的进程、改环境变量、动用户目录）：只报告现象，由使用者决定。
- 不要把"静默降级"当作容错：功能性失败要能被看见（写进任务错误、日志或界面提示），而不是悄悄退回慢路径。
