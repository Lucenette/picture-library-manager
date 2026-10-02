# Electron 依赖剥离与无头 server 模式

**状态**：待评审
**关联**：[visual-training-pipeline.md](./visual-training-pipeline.md)（无头/服务化是它跑在训练机上的前提）、[window-chrome.md](./window-chrome.md)（窗口外壳的改造与它同一批）

---

## 1. 背景

1. **Electron 是硬依赖，装不上就跑不起来。** 主进程有 21 个文件 `import electron`，渲染进程有 26 个文件 `import ipcRenderer`；而业务核心（`main/database` 的 CRUD 与排序键、`main/task/runners`、`main/image`、`main/ups`、`script/compile.ts`）本身并不依赖 Electron——耦合集中在「窗口」「原生对话框」「IPC 注册」三处。
2. **训练机不该背 Chromium。** 打包态的 Electron 带来 150~250 MB 运行时，并且必须起图形会话来跑；而 [visual-training-pipeline.md](./visual-training-pipeline.md) 规划的图库与训练更适合长期驻留在 GPU 机上，由另一台机器开网页操作。
3. **通道名已经集中。** `src/common/ipcChannels.ts`（131 行）把全部通道集中在一处，`src/common/types.ts` 定义了载荷，等于一份现成的 RPC 契约；缺的只是「谁来承载这些通道」。
4. **辅助窗口有 7 类**（图片查看器、扫描配置、批量处理、输入、确认、文件查看、相似管理），各自一个 `BrowserWindow` 与独立渲染进程。其中「文件查看」只是浏览一组文件并挑一张，从发起到落库的六跳里有四跳纯粹因为它跨了进程。
5. **无头服务需要一个标准的对外接入面。** 桌面模式的能力只能靠人点界面；server 模式才能对外暴露 `/metrics` 与能力清单，供外部监控或编排器定时拉取。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-02 | 首次定稿 | 讨论 Electron 剥离、server 模式与窗口收编 |

---

## 2. 目标与非目标

**目标**

1. 业务核心（下称 `core`）不 `import electron`，能在纯 Node ≥ 22.12 上启动。
2. 两个构建目标：`build:desktop`（现状）与 `build:server`（不含 Electron / Chromium），共用同一份 web 资源。
3. 用一条**命令总线（bus）**统一承载通道：桌面走 `ipcMain` / `ipcRenderer`，server 走 HTTP + WebSocket；`core` 与渲染进程都不感知差别。
4. 窗口分类收编：浏览与管理类大面板收进主窗口；短小确认 / 输入保留原生窗口；图片查看器与相似管理在 web 模式用新标签页。
5. 数据与缓存目录可配：`data` / `cache` / `scripts` / `logs` / `training` 各自可改地址，设置页标注生效时机。
6. 单写者保证：server 模式用文件锁替代 Electron 的单实例锁。
7. 对外接入面：`/metrics`、能力描述符、MCP 端点。

**非目标**

- 不改业务行为与桌面观感（桌面路径保持现状）；
- 不做云端多租户与账户体系；
- 不引入外部系统的代码，只通过 HTTP / MCP 对接；
- 不重写 UI 框架，视图层只换传输适配。

## 3. 设计

### 3.1 分层与目录

```
src/
  core/        平台无关：database / task / image / script / ups / loading / log / config
  bus/         契约与命令总线：registerCommand / invoke / emit
  shells/
    electron/  app 生命周期、window-manager、dialogs、IPC 适配
    server/    HTTP + WebSocket + 静态资源 + 鉴权 + CLI + 注册
  renderer/    视图不变，经 client 适配层调用 bus
  common/      类型与通道名（保留）
```

`core` 的依赖只剩 Node 内置模块与 `sharp`。

### 3.2 bus 契约

- `core` 侧：`registerCommand('task:submit', handler)` 与 `emit('task:changed', payload)`。
- 桌面 shell：把 bus 映射到 `ipcMain.handle` 与 `webContents.send`。
- server shell：`POST /rpc/{channel}`（invoke 语义）+ `WS /events`（推送语义）。
- 渲染进程：`invoke(channel, ...args)` / `on(channel, cb)`，由构建期 alias 选择 IPC 或 HTTP 实现。
- `db` 通道本来就是「单通道 + 方法名」，直接落成 `POST /db/{method}`。

### 3.3 窗口收编策略

| 类别 | 桌面 | web | 举例 |
|---|---|---|---|
| 浏览 / 管理类大面板 | 收进主窗口（抽屉或模态） | 同桌面 | 文件查看（本条目首个样板） |
| 短小确认 / 输入 | 原生窗口（保留） | 页内模态 | 确认、输入、重命名 |
| 重内容独立视图 | 原生窗口 | 新标签页 | 图片查看器、相似管理 |
| 锚定浮层 | 独立浮窗宿主 | 页内 popper | 脚本下拉、类型过滤 |
| 原生文件 / 目录选择器 | `dialog.showOpenDialog` | 服务端目录浏览 API | 选目录、选脚本文件 |

这一条会改写 [AGENTS.md](../../AGENTS.md)「弹窗一律用原生窗口」的口径：**原生窗口保留给短小确认与输入，浏览类大面板收进主窗口**。

### 3.4 收编样板：文件查看

现链路是 `FILE_VIEWER_OPEN` → 建窗 → `FILE_VIEWER_INIT` 取数 → `FILE_VIEWER_SELECT` → 主进程转 `FILE_VIEWER_SELECTED` → `ProcessPage` 落库，六跳里四跳只为跨进程。收编后变成主窗口内一个抽屉，`pick()` 直接落库。可删：`main/dialogs/file-viewer.ts`、`initFileViewer()`、`createFileViewer()`、四条通道、`/file-viewer` 路由；`FileViewerInitData` 从 `common/` 搬到组件类型（只有渲染进程用）。列表同时改成分页，避免一次取回整组文件。

### 3.5 路径与缓存设置

```yaml
dirs:
  data:     ~/.plmanager/data     # 库 + 备份；改动需重启
  cache:    ~/.plmanager/cache    # 缩略图 / 解码中间物；可随时删
  scripts:  ~/.plmanager/scripts
  logs:     ~/.plmanager/logs
  training: D:/AI/datasets        # 数据集 / 模型 / 训练元数据
```

`paths.ts` 现在用 `app.isPackaged` 决定 dev 与 packaged 两套路径，改为读配置 + 环境变量 + CLI（`PLM_HOME`）。缩略图现在是 WebP 字节存在库里的，随这次一起挪到 `cache/` 落盘——`docs/ARCHITECTURE.md` 已经注明「超过万级图片需要改成落盘缓存」。改 `data` 目录要提供「迁移 / 指向已有库」的引导，禁止热切换。

### 3.6 单写者锁

`node:sqlite` 是单写者。server 模式用数据目录里的锁文件（PID + 端口 + 心跳）替代 `app.requestSingleInstanceLock()`；拿不到锁的实例只读或拒绝启动。

### 3.7 安全

脚本系统在主进程执行任意 JavaScript，**这是设计如此**。因此 server 模式必须：默认绑 `127.0.0.1`、强制 token 鉴权、远程访问显式 opt-in 并提示风险、路径类 API 防目录穿越。**无鉴权的对外 server 等于一个远程代码执行接口。**

### 3.8 构建与产物

- `build:desktop`：现状（electron-vite + electron-builder）。
- `build:server`：`core` + server 打成纯 JS，`sharp` 按平台带预编译包，**不含 Electron / Chromium**；静态资源取自同一份 web 构建。
- `?nodeWorker` 是 electron-vite 的虚拟模块，server 构建要给出等价的 worker chunk 方案。
- 可选 Docker 镜像（多架构）。

### 3.9 对外接入面

无头模式下暴露 `/metrics`（供外部监控定时拉取）、能力描述符与 MCP 端点；`--register` 运行时开关决定是否向注册中心报到。注册中心选型见待决事项。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/core/` | 从 `src/main/` 抽出平台无关部分（database / task / image / script / ups / loading / log / config） |
| **新增** `src/bus/` | 命令总线与契约 |
| **新增** `src/shells/electron/` | 现有 `window-manager.ts`、`dialogs/`、`index.ts` 归位 |
| **新增** `src/shells/server/` | HTTP + WebSocket + 静态资源 + 鉴权 + CLI |
| `src/renderer/**`（26 个文件） | `ipcRenderer` 换成 client 适配层 |
| `src/main/paths.ts` | 改读配置 / 环境变量 |
| `src/main/database/db.ts`、`task/ipc.ts`、`script/ipc.ts`、`log/logger.ts`、`loading/progress.ts` | IPC 注册搬进 bus / shell |
| **删除** `src/main/dialogs/file-viewer.ts`、`src/renderer/views/dialogs/FileViewerDialog.vue` | 收编进主窗口 |
| `src/main/window-manager.ts` | 删 `createFileViewer()` |
| `src/common/ipcChannels.ts` | 删 `FILE_VIEWER_*` |
| `electron.vite.config.ts`、`package.json`、`electron-builder.yml` | 加 server 构建目标 |
| `docs/design/window-management.md`、`AGENTS.md`、`docs/ARCHITECTURE.md` | 更新辅助窗口清单与弹窗口径 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 无测试框架，重构没有回归网 | 与 [test-system.md](./test-system.md) 一起做，先钉住 task 状态机、DB CRUD、bus 路由 |
| 对话框 / 子窗口收编牵动 UI 语义 | 先只做「文件查看」一个样板，验证后再推其它 |
| `?nodeWorker` 在非 electron-vite 构建下失效 | 先验证 server 构建能产出 worker chunk |
| `node:sqlite` 在纯 Node 上未验证 | 在目标 Node 版本上实测开库与读写 |
| 无鉴权的 server 等于远程代码执行 | 默认 localhost + token，远程 opt-in |
| 目录迁移写错导致数据丢失 | 禁止热切换；迁移前备份；只读模式兜底 |
| 大爆炸式重构 | 每一步桌面路径都必须可跑，server 作为并行新增 |

## 6. 验证方法

1. 静态：给 `node scripts/check-code.mjs` 加一条「`src/core/**` 不得 import electron」的规则，先只在 CI 统计。
2. 纯 Node：不启动 Electron，用 Node 跑起 core 的开库与一次扫描任务。
3. bus：同一组命令分别经 IPC 与 HTTP 调用，返回一致。
4. 人工冒烟：桌面路径全功能回归；server 模式起服务，浏览器完成「添加来源 → 扫描 → 选图 → 导出」。
5. 体积：对比 desktop 与 server 两个产物的大小。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 核心目录叫 `src/core/`，还是保留 `src/main/` 只挪 shell | 抽 `core`，命名即边界 |
| 2 | server 框架（Fastify / Express / 裸 http） | Fastify（schema 校验、性能） |
| 3 | 注册中心用自建还是直接采用 MCP 生态 | 待定 |
| 4 | server 是否可能跑在与浏览器不同的机器上 | 决定路径选择器形态 |
| 5 | 桌面是否也把文件查看 / 批量处理 / 扫描配置收成页内 | 先只 web 收编，桌面不动 |
| 6 | 缩略图何时从库里挪到 `cache/` | 与「路径设置」同一批做 |
