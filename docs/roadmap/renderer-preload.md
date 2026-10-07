# 渲染进程权限收口：IPC 收进 preload

**状态**：待实施
**关联**：[file-watch.md](./file-watch.md)（排在它之后：那几笔新增的渲染进程侧调用在本项里一起迁到 preload）、[../ARCHITECTURE.md](../ARCHITECTURE.md)（进程模型与分层表要补 preload 一行）

---

## 1. 背景

1. **渲染进程现在什么都能拿**：`window-manager.ts` 的 `createWebPreferences()` 给四类窗口（主窗口、弹窗、查看器、浮窗）下发的是 `nodeIntegration: true` + `contextIsolation: false` + `sandbox: false`，没有 preload。于是渲染进程里 `require('fs')` 之类是通的（静态检查靠 ESLint 拦，不是靠运行时拦），`ipcRenderer` 也是全裸的。
2. **没有 preload 这一层，IPC 调用点散在界面里**：实测 **28 个文件、79 处 `ipcRenderer` 调用**（`invoke` 为主，另有 `on` / `once` / `send` / `removeListener` / `removeAllListeners`）。其中 **11 个是服务层与基础层**（`services/` 5、`db/database.ts`、`loading/index.ts`、`composables/` 2、`entries/` 2），**17 个是界面文件**（7 个对话框、2 个控件、浮窗宿主、查看器、5 个主页面、脚本侧栏）——界面直接跟主进程说话，通道名与载荷形状没有一处可审计的边界。
3. **`IpcRendererEvent` 从来没被用过**：三处签名里带着它（`loading/index.ts`、`composables/useIpcListener.ts`、`ScriptSideList.vue` 的 `filterListener`），参数一律写作 `_event`，一次都没读。它出现在渲染进程的类型里，纯属把底层对象漏了出去。
4. **构建这边也缺一块**：`electron.vite.config.ts` 只有 `main` 与 `renderer` 两段，每次构建都打一行 `(!) preload config is missing`——不是错误，但说明这个位置本来就是空的。
5. **文档把现状写成了「既有设计」**：AGENTS 运行时约定第 1 节明说「本项目渲染进程启用了 `nodeIntegration`、关闭了上下文隔离……这是既有设计，不算违规」。收口落地后这句要改，否则规范会继续为旧结构背书。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-07 | 首次定稿 | 需求：渲染进程的能力全部收到 preload；与 [file-watch.md](./file-watch.md) 同版（1.1.2），排在其后 |

---

## 2. 目标与非目标

**目标**

1. 渲染进程**不能再直接引用 `electron`**，能力只有一个出口：preload 通过 `contextBridge` 暴露的 `window.plm`。
2. 三条开关一起翻：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`（四类窗口共用 `createWebPreferences()`，一处生效）。
3. 通道**白名单**在 preload 里强制：只放行 `common/ipcChannels.ts` 里登记过的通道，渲染进程无法调用未登记的处理器。
4. 界面里那 17 个文件不再直接说话：IPC 收进服务层，界面只调服务。
5. 收口由静态检查守住：渲染进程 `import ... from 'electron'` 被 ESLint 拦，通道名仍只有 `IPC` 一处来源。

**非目标**

- 不改任何通道的语义、载荷形状与主进程侧处理器；
- 不重写渲染进程的状态管理（`useTasks` 那套「订阅挂模块」的不变量不动，只换它调用的入口）；
- 不做渲染进程侧的渲染沙箱/内容安全策略（CSP）——那是另一件事，本项只管能力出口。

## 3. 设计

### 3.1 一份 preload 服务四个入口

- 新窗口类不再各写一份：四类窗口的 `webPreferences` 都来自 `createWebPreferences()`，preload 路径在那一处给。
- 产物在 `out/preload/index.js`，主进程用 `join(__dirname, '../preload/index.js')` 定位（开发态与打包态是同一套相对布局；打包时随 `files: out/**/*` 进包，不需要额外配置）。
- `electron.vite.config.ts` 补 `preload` 段（默认入口 `src/preload/index.ts`），那行 `preload config is missing` 随之消失。

### 3.2 preload 的对外形状

`contextBridge.exposeInMainWorld('plm', api)`，api 只有四个方法（都做通道白名单校验）：

```ts
invoke(channel, ...args): Promise<unknown>   // 请求-应答；主进程所有 handle 都走它
send(channel, ...args): void                 // 单向（目前只有渲染进程的日志转交用它）
on(channel, listener): () => void            // 订阅推送；返回值即注销函数
once(channel, listener): void                // 一次性订阅（对话框结果那类）
```

三条约定：

1. **通道白名单的判据是 `Object.values(IPC)`**。新增通道只需在 `common/ipcChannels.ts` 加一个常量，preload 不用改——白名单不会腐烂成一份要手工同步的镜像。
2. **`IpcRendererEvent` 不再外露**：preload 内部把事件对象吃掉，`listener` 只收载荷。现有三处带 `_event` 的签名随之简化。
3. **不暴露 `removeListener` / `removeAllListeners`**：`on()` 返回的注销函数就是唯一出口，避免出现「按名字删别的模块的监听」这种跨模块操作。

**为什么不在 preload 里堆按域命名的方法表**（`plm.task.submit(...)` 那一类）：域的语义分组是渲染进程内部的组织方式，服务层（`services/*`）已经在做这件事；在 preload 再镜像一份 90 多个方法，等于给同一张通道表维护两个副本，而与「白名单」对应的安全收益已经由第 1 条拿到。

### 3.3 迁移：79 处调用，两种改法

| 类别 | 文件数 | 改法 |
|---|---|---|
| 服务层与基础层 | 11（`services/` 5、`db/database.ts`、`loading/index.ts`、`composables/useIpcListener.ts`、`composables/useTasks.ts`、`entries/main.ts`、`entries/shell/theme.ts`） | 把 `ipcRenderer.invoke/on/...` 换成 `window.plm.*`，签名照旧（`useIpcListener` 内部改托管 `plm.on` 返回的注销函数） |
| 界面文件 | 17（7 个对话框、`DropdownControl` / `DropdownContent` / `TypeFilter`、`PopupHost`、`ImageViewer`、`ScriptSideList`、5 个主页面） | 界面不再直接说话：按域收进 `services/`（已有 `task-service` / `script-service` / `settings-service` / `dialog-service` 的路子），界面只调服务 |

`services/` 的职责与今天一致（「渲染进程：界面、状态、IPC 包装」），本项只是让它成为**唯一**的包装处。

### 3.4 类型与工程

- **契约类型放 `src/common/ipcApi.ts`**：preload 实现它、渲染进程消费它；与通道表同一个目录，新增通道时两处一起看。放到 `src/preload/` 再让渲染进程引用会引出跨目录别名。
- **全局声明**：`src/renderer/env.d.ts` 里 `declare global { interface Window { plm: PlmApi } }`，`PlmApi` 从 `@common/ipcApi` 取。
- **构建项目**：`src/preload/**/*.ts` 加进 `tsconfig.web.json`（它是渲染进程侧的脚本），**不加**进 `tsconfig.node.json`；`eslint.config.mjs` 的 `TYPED_FILES` / `RENDERER_FILES` 相应加上 `src/preload/**`。
- **preload 的依赖面**：只允许 `electron`（`contextBridge` / `ipcRenderer`）与 `@common/*`，**不许引业务模块**；`sandbox: true` 下 preload 只能 `require` electron 的少量 API，我们正好只需要这两个，所以打包进来的 `common/ipcChannels.ts` 是唯一的"自己的代码"。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/preload/index.ts` | `window.plm` 的四个方法与通道白名单 |
| **新增** `src/common/ipcApi.ts` | `PlmApi` 契约类型（preload 与渲染进程共用） |
| **新增** `src/renderer/global.d.ts`（或并入 `env.d.ts`） | `window.plm` 的全局声明 |
| `src/main/window-manager.ts` | `createWebPreferences()` 翻三条开关并注入 preload；`sandbox` 的取舍理由写在注释里 |
| `electron.vite.config.ts` | 补 `preload` 段 |
| `tsconfig.web.json`、`eslint.config.mjs` | 加 `src/preload/**`；渲染进程 **禁引 `electron`** |
| `src/renderer/services/*.ts`、`db/database.ts`、`loading/index.ts`、`composables/*`、`entries/*` | 79 处调用改走 `window.plm` |
| 17 个界面文件 | 直接调用收进服务层 |
| `AGENTS.md`、`docs/ARCHITECTURE.md`、`README.md` 的目录树 | 收口落地后：加 `src/preload/` 一行，改掉「渲染进程直接引用 electron 是既有设计」的表述 |
| `docs/design/` | 落地后由本文件迁入 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 四类窗口任意一个起不来或丢事件 | 每个窗口都要冒烟（主窗口 7 个页面、7 个对话框、查看器、浮窗）；`sandbox: true` 实测受阻时退回 `sandbox: false` 并在文档写明理由 |
| 漏迁一处调用 → 运行时 `window.plm` 未定义 | 渲染进程禁引 `electron` 的 ESLint 规则是机械保障；`window.plm` 的类型声明让漏改处在 `vue-tsc` 就报 |
| 通道白名单挡掉合法调用 | 白名单取 `Object.values(IPC)`，与主进程注册用的是同一张表；冒烟覆盖每类窗口的主路径 |
| 用户脚本里的 `require` 被误解为受影响 | 脚本在**主进程**执行，与渲染进程能力无关；Monaco 那段 `declare function require` 描述的是脚本运行环境，不动 |
| 打包后 preload 路径找不到 | 相对布局（`out/main` → `out/preload`）开发态与打包态一致；打包后启动一次确认 |

## 6. 验证方法

1. **静态**：渲染进程 `import ... from 'electron'` 命中 ESLint 即失败（可用一次 `--stdin` 试跑确认规则真的会拦）；`tsc` / `vue-tsc` / `yarn lint` 全过。
2. **人工冒烟**（每一项都要真开窗口）：
   - 主窗口 7 个页面各自的主路径（扫描提交、选图、导出、脚本保存、任务控制、设置改主题）；
   - 7 个对话框各开一次（确认、输入、扫描配置、批量处理、文件查看、相似结果）与查看器、浮窗；
   - 关窗退出符合预期（不因 preload 多留一个监听而挂住）；
   - `window.require` / `window.process` 在渲染进程里确实是 `undefined`（收口的直接证据）；
   - 打包后启动一次，确认 preload 路径与四类窗口都正常。

## 7. 已知取舍

| 取舍 | 代价 |
|---|---|
| 能力只走 preload | 每次加通道要经过 `common/ipcChannels.ts`（本来就是唯一来源，成本接近零） |
| 界面不再直接说话 | 17 个文件要挪一层；换来「一个地方能审计渲染进程的全部对外调用」 |
| 白名单在 preload 用运行时校验 | 通道名写错时不再是编译错误而是运行时报错；靠 `IPC` 常量 + 类型声明把大部分写错挡在编译期 |
| `sandbox: true` | preload 只能用 electron 的少量 API；我们要用的正好只有 `contextBridge` 与 `ipcRenderer`，所以不构成限制 |

## 8. 待决事项

无。
