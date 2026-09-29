# 架构说明

面向要改这个仓库的人。目录归属与代码规范的硬性要求见 [AGENTS.md](../AGENTS.md)，这里讲的是**结构为什么是这样**。

单个子系统的设计说明（为什么这样、有哪些不变量、改动时注意什么）在 [design/](./design/)。

---

## 进程模型

```
┌──────────────────────── 主进程（Node） ──────────────────────────┐
│                                                                  │
│  index.ts            启动：窗口 → 开库 → IPC → 迁移 → 任务管理器 │
│  database/           开库、CRUD、changelog 迁移与账本            │
│  log/                日志：配置、捕获与三个文件                  │
│  window-manager.ts   窗口工厂与注册表                            │
│  dialogs/            每个辅助窗口一个模块 + 其 IPC               │
│  image/              图片处理流水线                              │
│  script/             用户脚本的文件、草稿、编译与调用            │
│  task/               后台任务编排                                │
│                                                                  │
│       ┌─────────── worker 线程池（min(4, cpus-1)）───────────┐   │
│       │  thumbnail-worker.ts ← 只收发消息                    │   │
│       │  thumbnail-decode.ts ← 读尺寸 / 解码 / 缩放          │   │
│       └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
        ▲ IPC（invoke 命令 + push 事件）
        │
┌───────┴────────────────────────────────────────────────────────┐
│ 渲染进程 × N（每个 BrowserWindow 一个）                          │
│  主窗口：5 个业务页 + 任务页 + 启动加载页，共用 App.vue 的骨架   │
│  辅助窗口：查看器 / 扫描配置 / 批量处理 / 输入框 / 文件查看等  │
│                                                                │
│  只做界面。禁止引用 fs / path / crypto / 图像解码库              │
└────────────────────────────────────────────────────────────────┘
```

**每类窗口一份渲染进程入口**（`src/renderer/entries/`）：主窗口 `index.html` 用 vue-router 管六个页面；六个弹窗、图片查看器、仿原生浮窗各有更小的一份（`dialogs.html` / `viewer.html` / `popup.html`），按 hash 直接挂载单个页面、不引 vue-router。入口里只 import 这个窗口要用的东西——Element Plus 只出现在主窗口与弹窗入口里；图片查看器与浮窗入口连 vue-router 都不引。主窗口一律先落在 `/loading`，加载页读到加载服务公布的终态后用 `router.replace('/')` 切回主界面——正常启动时它什么都不画，所以不会闪。启动阶段要做的事（升级、其余初始化、脚本页预热）都登记给加载服务，见 [design/loading.md](./design/loading.md)。缘由与约束见 `docs/design/window-management.md` 第 4 节。

辅助窗口目前包括图片查看器、扫描配置、批量处理、输入框、确认框、文件查看、下拉浮窗，每一个都对应 `main/dialogs/` 下的一个模块与一条 hash 路由。

窗口的生死由 `window-manager` 的注册表统一管：主窗口是应用的**生命周期锚点**，它一关，其余窗口被一并关掉，
进程随即退出。这条不能靠"最后一个窗口关闭"这个事件自己成立——下拉浮窗的宿主是常驻窗口，从不销毁。
详见 [design/window-management.md](./design/window-management.md)。

---

## 主进程分层

| 目录 | 职责 | 不该出现 |
|---|---|---|
| `image/` | 图库目录 → 可入库的图片记录 | 任务、进度、图库等业务概念 |
| `task/` | 队列、状态机、取消、进度、事件推送 | 具体重计算（交给 `image/` 的线程） |
| `script/` | 用户脚本的文件与草稿（`scripts/`、`temp/scripts/`）、编译与方法调用 | SQL 与表结构——那是 `database/` 的事 |
| `dialogs/` | **自己创建 `BrowserWindow`** 的模块 | 不持有窗口的 IPC |
| `ups/` | 升级模块：版本目录（`preups.ts` / `dbups.xml` / `postups.ts`）、引擎 | 反向依赖业务模块 |
| `loading/` | 启动加载服务：任务登记与调度、加载页状态、渲染进程任务下发 | 具体任务本身——升级在 `ups/` |
| `database/` | 开库、CRUD、账本读写、DB 的 IPC 调度；`sort/` 子目录把文本算成可比较的排序键（见 [design/sort-keys.md](./design/sort-keys.md)） | 升级的编排与版本目录——那是 `ups/` 的事；建表语句——写进 `ups/changesets/<版本>/dbups.xml` |
| `log/` | 日志：log4js 配置与三个文件（`root.log` / `external.log` / `script.log`）、stdout/stderr 补丁与渲染进程 console 的捕获、通道分流 | 反向依赖业务模块；把它登记成加载任务——启动阶段它必须最先可用 |

判断口径：**按职责归类，不按"谁在用我"归类。** `database` 也只被少数模块使用，但它独立存在。

`dialogs/` 的每个模块都对应一个原生子窗口。界面上的确认、输入、提示一律走这条路径，不要用浏览器的 `confirm()` / `alert()` 或 Element Plus 的 `ElMessageBox`——它们画在主窗口内部，观感跟其余弹窗是两套。渲染进程侧统一调用 `@/services/dialog-service` 的 `confirmDialog()` / `alertDialog()`。

---

## IPC 约定

三类通道，命名与归属都有规律：

| 类型 | 形式 | 例子 |
|---|---|---|
| 数据库调度 | 单通道 `db` + 方法名 | `ipcRenderer.invoke('db', 'getAllSources')` |
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

进度**实时推送给渲染进程**，但**写库被节流到 ≥1s**——进度变化不值得每次都写一次库。状态跃迁（开始/暂停/终态）立即落库。

---

## 线程边界

这是本项目最关键的一条约束：**一次调用若可能持续几十毫秒以上且中途无法让出，就不能放在主进程主线程上。**

浏览器进程被同步 CPU 占住时，窗口消息无人处理，**窗口会卡到拖不动**。因此：

| 工作 | 位置 | 原因 |
|---|---|---|
| 目录遍历 + 读图片头 | 主进程，分片让出 | I/O 密集，每 200 个条目 `await setImmediate` |
| 解码 + 缩放 | **worker 线程池** | 单张 4K JPEG 解码数百毫秒，纯 CPU 且原子 |
| 数据库写入 | 主进程，同步 | node:sqlite 写 WAL，毫秒级 |
| 文件复制（导出） | 主进程，按张让出 | 单张复制很快，但总量大 |

工作线程的接入点由 electron-vite 的 `?nodeWorker` 提供（`vite:node-worker` 插件内置在主进程构建里），它会把 `thumbnail-worker.ts` 产出为独立 chunk 并生成 Worker 工厂，**不需要改构建配置**。

> 线程内的解码是卸载，不是并行算法：池子只做「多张图同时解码」，单张图内部仍然串行。

### 解码引擎

`thumbnail-sharp.ts` 是唯一实现：libvips 对大图做 shrink-on-load（1/2、1/4、1/8），不把整图铺成
RGBA 位图——一张 15360×8640 的 JPEG 按整图解码要 530 MB。**没有内置纯 JS 解码器，也没有回落**：
`sharp` 是显式依赖，加载失败会直接报错，不会静默换成慢路径。

**内存调度**：解码的内存需求是 `宽 × 高 × 4`（实测峰值约为它的 1.9 倍），**与文件体积无关**。
调度按这个估算分批（`DECODE_MEMORY_BUDGET_BYTES`），而不是按文件大小——实测 7.6 MB 的 JPEG
是 11520×8640，需要 380 MB。

---

## 数据库与持久化

- **`node:sqlite`**：库是真实文件 + WAL，单条 INSERT 只追加日志，毫秒级完成，不再有「整库导出 + 整文件替换」。
- 因此 `beginBatch()` / `endBatch()` 只用来表达「要么全做、要么全不做」；**逐单元提交是允许且鼓励的**。
- 运行期仍按 30 秒间隔保留一份 `<db>.bak` 作为误操作兜底。

### 升级由版本目录演进

建表语句不在代码里，而在 `src/main/ups/changesets/<版本号>/dbups.xml` 的 `<changeSet>` 里。一个版本目录是最多三件东西：
`preups.ts`（SQL 之前跑）、`dbups.xml`、`postups.ts`（SQL 之后跑），缺哪个跳过哪个。启动时把这份清单与账本表
`schema_migration` 对一遍，没执行过的按顺序跑掉，每一步一个事务；脚本抛错时它写进库的东西随事务回滚。
版本号写在各版本目录的 `index.ts` 里（与目录名无关），清单顺序即执行顺序；已发布的目录冻结，新的变更写进新版本目录。

账本表本身由引擎用代码创建：账本不存在时，没有任何地方能记录「创建账本」这件事。
需要重建表（SQLite 改列类型只能「建新表 → 搬数据 → 换名」）时，同样写成一条 changeSet，而不是在启动代码里判断列名后 `DROP`。

主窗口启动时先落在加载页；加载服务把所有「必须」的启动任务跑完（升级是其中之一，没有待执行步骤时它空转）后自动切回主界面。

---

## 一次扫描的完整数据流

```
渲染进程  点「扫描」→ 选结构脚本 → actions.submit('scan', {sourceId, scriptId})
   ↓ task:submit
主进程    TaskManager.submit()：写 task 表(pending) → 入队 → 渲染进程收到 task:changed
   ↓ tick()
          runner = runners/scan.ts，状态转 running
   ↓
   ①  buildDirTree()            读目录结构（分片让出）
   ②  executeScript('identify-structure')   结构脚本把目录树映射成 角色→图片组
   ③  collectImageFiles()       收集文件清单（只读名字/大小/扩展名）
   ④  ThumbnailPool.analyze()   每批 pool.concurrency 张，派给工作线程
                                线程内：sharp 解码 + 缩放到 100×100 + 出 WebP 字节
   ⑤  beginBatch()
          clearSourceData()    到这里才允许动数据库
          insertCharacter / insertImageGroup / insertImageFiles
          updateSourceScannedAt
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
| 数据库 | node:sqlite（真实文件 + WAL） | 每次写入都要落盘，原子性靠事务边界；换来无需整库导出、崩溃不丢已完成的部分 |
| 缩略图 | 100×100 WebP 字节存进数据库 | 比 PNG+Base64 小三分之二左右，预览零开销；超过万级图片需要改成落盘缓存 |
| 任务并发 | 恒为 1 | 简单、中间态可推理；换来任务之间互相等待 |
| 扫描写库 | 全部算完再一次性入库 | 单个图库的缩略图要占内存；换来取消不留脏数据 |
| 脚本执行 | 主进程、无沙箱、导入即执行 | 有安全边界要求的使用者需谨慎；换来脚本能自由访问文件系统 |
| 结构演进 | 版本化 changelog + 账本 | 多一层间接；换来老库能自动升级、不必再手工执行不可逆的 `ALTER TABLE` |
