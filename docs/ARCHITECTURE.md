# 架构说明

面向要改这个仓库的人。目录归属与代码规范的硬性要求见 [AGENTS.md](../AGENTS.md)，这里讲的是**结构为什么是这样**。

---

## 进程模型

```
┌──────────────────────── 主进程（Node） ────────────────────────┐
│                                                                │
│  index.ts            启动：DB → IPC → 窗口 → 任务管理器          │
│  db.ts / sql.ts      sql.js（内存 SQLite）+ 原子落盘             │
│  window-manager.ts   窗口工厂与注册表                            │
│  dialogs/            每个辅助窗口一个模块 + 其 IPC                │
│  image/              图片处理流水线                              │
│  script/             用户脚本的编译与调用                        │
│  task/               后台任务编排                                │
│                                                                │
│        ┌───────────── worker 线程池（min(4, cpus-1)）────────┐   │
│        │  thumbnail-worker.ts ← 只收发消息                    │   │
│        │  thumbnail-decode.ts ← 读尺寸 / 解码 / 缩放         │   │
│        └────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
        ▲ IPC（invoke 命令 + push 事件）
        │
┌───────┴────────────────────────────────────────────────────────┐
│ 渲染进程 × N（每个 BrowserWindow 一个）                          │
│  主窗口：5 个业务页 + 任务页，共用 App.vue 的导航骨架             │
│  辅助窗口：查看器 / 扫描配置 / 批量处理 / 输入框 / 文件查看等  │
│                                                                │
│  只做界面。禁止引用 fs / path / crypto / 图像解码库              │
└────────────────────────────────────────────────────────────────┘
```

所有窗口共用同一份渲染进程入口（`src/renderer/main.ts`），靠 **hash 路由**区分身份：无 hash 的是主窗口，其余是各自独立窗口。`App.vue` 通过 `POPUP_ROUTES` 判断是否要套导航骨架。

辅助窗口目前包括图片查看器、扫描配置、批量处理、输入框、确认框、文件查看、下拉浮窗，每一个都对应 `main/dialogs/` 下的一个模块与一条 hash 路由。

---

## 主进程分层

| 目录 | 职责 | 不该出现 |
|---|---|---|
| `image/` | 图库目录 → 可入库的图片记录 | 任务、进度、图库等业务概念 |
| `task/` | 队列、状态机、取消、进度、事件推送 | 具体重计算（交给 `image/` 的线程） |
| `script/` | 用户脚本的编译与方法调用 | 业务规则 |
| `dialogs/` | **自己创建 `BrowserWindow`** 的模块 | 不持有窗口的 IPC |
| `db.ts` | CRUD + 批量落盘 + DB 的 IPC 调度 | 业务编排 |

判断口径：**按职责归类，不按"谁在用我"归类。** `db` 也只被少数模块使用，但它独立存在。

`dialogs/` 的每个模块都对应一个原生子窗口。界面上的确认、输入、提示一律走这条路径，不要用浏览器的 `confirm()` / `alert()` 或 Element Plus 的 `ElMessageBox`——它们画在主窗口内部，观感跟其余弹窗是两套。渲染进程侧统一调用 `@/services/dialog-service` 的 `confirmDialog()` / `alertDialog()`。

---

## IPC 约定

三类通道，命名与归属都有规律：

| 类型 | 形式 | 例子 |
|---|---|---|
| 数据库调度 | 单通道 `db` + 方法名 | `ipcRenderer.invoke('db', 'getAllGalleries')` |
| 任务命令 | `task:*` 若干 invoke | `task:submit` / `task:pause` / `task:forceStop` |
| 主进程推送 | `*:changed` / `*:progress` | `task:changed` / `task:progress` |

约定：

- **命令一律返回最新状态。** 任务的每个命令都返回完整任务列表，渲染进程整表替换；只有执行期的高频进度走推送。这样调用方不必自己拼接状态。
- **推送分两档。** 状态变化（低频）带完整对象走 `task:changed`；进度（高频）只带 `{id, progress, message}` 走 `task:progress`，渲染进程就地打补丁，不触发整表重渲染。
- **订阅必须成对注销。** 统一用 `composables/useIpcListener.ts`，它把订阅挂在组件生命周期上。裸写 `ipcRenderer.on` 会在页面反复挂载时堆积监听器，导致一次操作被执行多次。

---

## 任务系统

### 状态机

```
pending ──开始──▶ running ──┬──▶ done
   │                        ├──▶ failed ──重试──▶ 新任务
   └──取消──▶ cancelled ◀───┴──暂停/继续──▶ paused
```

- **并发度恒为 1**：`TaskManager` 用一个 `runningId` 占用队列。三类任务会互相踩（导出读 `image_file`、扫描重写同一批数据），串行是唯一能给出正确中间态的调度方式。
- **暂停与取消是协作式的**：runner 在每个处理单元之间调用 `ctx.checkpoint()`，暂停在这里挂起、取消在这里抛 `TaskCancelledError`。**同步的整图解码无法被打断**，因此响应延迟的上限是一张图的解码时间。
- **强制结束**：立刻把状态落到终态并释放队列，不等 runner 收尾；runner 会在下一个检查点自行退出。因为所有任务都把写库安排在最后一步且同步完成，这样不会留下半成品。
- **重启后的处理**：`running`/`paused` 标记为「失败（任务中断）」；`pending` 保留并继续排队。正常退出时进行中的任务标记为「已取消（应用退出）」。

### 进度与落盘

进度**实时推送给渲染进程**，但**写库被节流到 ≥1s**——进度变化不值得每次都触发一次整库导出。状态跃迁（开始/暂停/终态）立即落库。

---

## 线程边界

这是本项目最关键的一条约束：**一次调用若可能持续几十毫秒以上且中途无法让出，就不能放在主进程主线程上。**

浏览器进程被同步 CPU 占住时，窗口消息无人处理，**窗口会卡到拖不动**。因此：

| 工作 | 位置 | 原因 |
|---|---|---|
| 目录遍历 + 读图片头 | 主进程，分片让出 | I/O 密集，每 200 个条目 `await setImmediate` |
| 解码 + 缩放 | **worker 线程池** | 单张 4K JPEG 解码数百毫秒，纯 CPU 且原子 |
| 数据库写入 | 主进程，同步 | sql.js 是内存库，毫秒级 |
| 文件复制（导出） | 主进程，按张让出 | 单张复制很快，但总量大 |

工作线程的接入点由 electron-vite 的 `?nodeWorker` 提供（`vite:node-worker` 插件内置在主进程构建里），它会把 `thumbnail-worker.ts` 产出为独立 chunk 并生成 Worker 工厂，**不需要改构建配置**。

> 线程内的解码是卸载，不是并行算法：池子只做「多张图同时解码」，单张图内部仍然串行。

### 解码引擎

`thumbnail-engine.ts` 在两种实现间选择：

| 引擎 | 实现 | 内存 | 说明 |
|---|---|---|---|
| `sharp` | libvips | 低 | 可选依赖。对大图 shrink-on-load，不铺开整图；跨平台；N-API，无需 rebuild |
| `builtin` | jpeg-js / pngjs / … | 高 | 开箱即用，零原生依赖。**必须先把整图铺成 RGBA**，一张 15360×8640 的 JPEG 就要 530 MB |

`sharp` 加载失败或某张图它读不了时逐张回落到 `builtin`，因此它是「可选加速」而非硬依赖。
实际使用的引擎会写进扫描任务的结果，任务页可见。

**内存调度**：解码的内存需求是 `宽 × 高 × 4`（实测峰值约为它的 1.9 倍），**与文件体积无关**。
调度按这个估算分批（`DECODE_MEMORY_BUDGET_BYTES`），而不是按文件大小——实测 7.6 MB 的 JPEG
是 11520×8640，需要 380 MB。

---

## 数据库与持久化

- **sql.js（WASM SQLite）**，整个库常驻内存，落盘 = 序列化后写文件。
- 因此**逐条写 = 每次重写整个库**。所有批量写必须包在 `beginBatch()` / `endBatch()` 之间，由后者统一落盘。
- 落盘策略：写临时文件 → `fsync` → 原子替换；并按 30 秒间隔保留一份 `.bak`。这样崩溃永远不会留下半截文件。
- 定时落盘有 300ms 防抖与 3s 兜底；退出前强制落盘。

### task 表

任务表允许重建：`initDatabase()` 会检查 `PRAGMA table_info(task)`，若缺少新结构的列就 `DROP` 后重建。判断列名而不是无条件 DROP，是为了以后不会误删真实的任务历史。

---

## 一次扫描的完整数据流

```
渲染进程  点「扫描」→ 选结构脚本 → actions.submit('scan', {galleryId, scriptId})
   ↓ task:submit
主进程    TaskManager.submit()：写 task 表(pending) → 入队 → 渲染进程收到 task:changed
   ↓ tick()
          runner = runners/scan.ts，状态转 running
   ↓
   ①  buildDirTree()            读目录结构（分片让出）
   ②  executeScript('identify-structure')   结构脚本把目录树映射成 角色→图片组
   ③  collectImageFiles()       收集文件清单（只读名字/大小/扩展名）
   ④  ThumbnailPool.analyze()   每批 pool.concurrency 张，派给工作线程
                                线程内：imageSize 读尺寸 + 解码 + 裁剪缩放 → base64
   ⑤  beginBatch()
          clearGalleryData()    到这里才允许动数据库
          insertCharacter / insertImageGroup / insertImageFiles
          updateGalleryScannedAt
       endBatch()               一次性落盘
   ↓
          task 表转 done，推送 task:changed
```

关键点：**①②③④ 全程不碰数据库**。所以脚本报错、暂停、取消、强制结束都不会破坏图库原有数据——要么整库更新完成，要么原样不动。

---

## 扩展：新增一种任务

按这个顺序改，五处：

1. `src/common/types.ts` —— 加 `XxxTaskPayload` / `XxxTaskResult`，并入 `TaskPayload` / `TaskResult` 联合类型与 `TaskType`
2. `src/main/task/runners/xxx.ts` —— 实现 `runXxx(ctx)`，在单元边界调用 `ctx.checkpoint()`
3. `src/main/task/manager.ts` —— `RUNNERS` 表加一项；`buildTitle()` 加一个分支
4. `src/renderer/views/main/TaskPage.vue` —— `TYPE_LABELS` / `TYPE_TAGS` 各加一项
5. 发起处 —— `actions.submit('xxx', payload)`

---

## 关键取舍

| 取舍 | 选择 | 代价 |
|---|---|---|
| 数据库 | sql.js（内存 + 整库落盘） | 写放大明显，靠批量提交缓解；换来零原生依赖、绿色便携 |
| 缩略图 | Base64 存进数据库 | 库体积大（实测约九成是缩略图），但预览零开销；超过万级图片需要改成落盘缓存 |
| 任务并发 | 恒为 1 | 简单、中间态可推理；换来任务之间互相等待 |
| 扫描写库 | 全部算完再一次性入库 | 单个图库的缩略图要占内存；换来取消不留脏数据 |
| 脚本执行 | 主进程、无沙箱、导入即执行 | 有安全边界要求的使用者需谨慎；换来脚本能自由访问文件系统 |
