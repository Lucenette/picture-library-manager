# AGENTS.md

给在本仓库工作的编码代理（AI 或人类）的约定。**动手前请先读完这一份。**

---

## 项目速览

- **是什么**：Electron 桌面应用，扫描来源各异的图库目录、批量选图、导出到统一目录。
- **技术栈**：Electron 40 + Vue 3 + TypeScript 5 + Vite 6 + Element Plus 2 + node:sqlite（Electron 内置 SQLite）+ sharp（图片解码）。
- **分支**：`develop`。提交信息用中文，形如 `范围：做了什么`（如 `对话框原生化：PromptDialog + FileViewerDialog`）。
- **数据目录**：开发态在 `dist/data/picture-lib.db`，打包后在 exe 同级的 `data/` 下。

## 常用命令

| 命令 | 作用 | 备注 |
|---|---|---|
| `yarn dev` | 启动开发环境 | 主进程/preload 由 electron-vite 构建，渲染进程走 Vite |
| `yarn typecheck` | `tsc`（主进程与 `common`）+ `vue-tsc`（渲染进程，含 `.vue`） | **`.vue` 的类型错误只有 `vue-tsc` 能发现**，只跑 `tsc` 会漏 |
| `yarn build` | 打包 NSIS 安装程序 | 产物 `dist/PLManager_Setup_<version>.exe` |

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
| `src/main/dialogs/` | **自己创建 `BrowserWindow`** 的模块 | 不持有窗口的 IPC——跟业务模块放一起 |
| `src/main/script/` | 处理脚本的编译与调用 | |
| `src/renderer/` | 界面、状态、IPC 包装 | **任何 Node 内置模块或 Node 专属依赖**（`electron` 的 `ipcRenderer` 除外） |
| `docs/` | 设计说明、不变量、排障 | 尚未实施的方案——放进 `docs/roadmap/` |

判断口径：**按职责归类，不按"谁在用我"归类。** 一个模块只有一个调用方，不构成把它塞进调用方目录的理由（`db` 也只被少数模块用，但它独立存在）。

---

## 文档与状态

- 设计说明、不变量与排障写在 `docs/`；**尚未实施的方案写在 `docs/roadmap/`**，一个功能一个文件（kebab-case），状态取值见该目录的 README。
- 文档写**为什么**与**约束**，不重抄代码已经表达清楚的"怎么做"。
- 方案落地后更新 roadmap 中对应文件的状态并补上提交号，**不要删除文件**。
- AI 或工具的临时工作状态（待办清单、缓存、会话记录）**不进版本库**，放各自的工具目录并由 `.gitignore` 忽略。

---

## 硬性代码规范

### 1. 禁止命名空间导入

```ts
// ❌
import * as db from '@/db';
export * from './types';

// ✅
import { getAllGalleries, insertTask } from '@/db';
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
- 不需要窗口的 → 跟业务模块放一起（如 `task/ipc.ts`），在 `src/main/index.ts` 里与 `initDbIpc()` 并列注册。

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
- **提交命令额外返回新任务 id**（`TaskSubmitResult`）：它是唯一带额外返回值的命令，调用方不应去列表里猜。
- **取消与强制结束必须经 `ctx.onAbort(...)` 立刻释放资源**（线程池、句柄），不能等 runner 走到下一个检查点：
  worker 线程会阻止主进程退出，等待检查点会让"关窗不退出"复发。
- 进度写库节流到不低于 1 秒；任务成功结束时进度记为 100%。
- 新增一种任务照 `docs/ARCHITECTURE.md` 末尾的五步配方；runner 只在单元边界调用 `ctx.checkpoint()`。

---

## 已知环境限制

- **`yarn build` 可能无法在受限沙箱里跑完**：esbuild 需要 `spawn` 子进程并用命名管道通信，沙箱会以 `spawn EPERM` 拒绝。遇到时如实说明"构建未验证"，不要假装通过，也不要绕过沙箱。
- **`vue-tsc` 已随依赖安装**（当前 5.9.3）：`tsc` 只覆盖主进程与 `common`，**`.vue` 的类型错误必须靠 `vue-tsc`**。
  只跑 `tsc` 就宣称"类型已检查"是错的——曾经因此漏掉一个缺失的 import，对应按钮一点就报 `ReferenceError`。
- **Windows 终端中文乱码**：默认 GBK 代码页，Node 按 UTF-8 输出，日志在终端显示为乱码；`chcp 65001` 后正常。文件内容不受影响。
- **`yarn.lock` 被 `.gitignore` 忽略**：CI 无法使用冻结锁文件，依赖版本以 `package.json` 为准。
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
5. 导入解析：确认所有 `@/` 与 `@common/` 路径都能落到真实文件（`?nodeWorker` 除外）。
6. 渲染进程不得引用 Node 模块（见上面第 1 条约定）。

改动涉及运行时行为时（尤其是新起的窗口、worker、IPC 通道），**静态检查通过不等于功能正常**，要在回复里明确说清哪些是"已验证"、哪些需要使用者手动冒烟。

---

## 明确不要做的事

- 不要擅自 `git commit` / `git push`，除非明确要求。
- 不要顺手改动目录结构或文件位置（见开头"动手前的边界"）。
- 不要改动 `data/` 下示例脚本的语义。
- **不要改动 `package.json`、不要自行安装或卸载依赖**（包括 `yarn add`）：需要新依赖时说明理由与命令，等使用者执行。
- **不要结束进程、不要改系统状态**（杀他人的进程、改环境变量、动用户目录）：只报告现象，由使用者决定。
- 不要把"静默降级"当作容错：功能性失败要能被看见（写进任务错误、日志或界面提示），而不是悄悄退回慢路径。
