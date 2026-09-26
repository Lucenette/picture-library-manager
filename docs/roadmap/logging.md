# 日志系统

**状态**：待评审（初稿，方案尚未评审）
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)、[TROUBLESHOOTING.md](../TROUBLESHOOTING.md)

---

## 1. 背景

1. **打包后没有任何日志。** 主进程的输出现阶段全部经 `console.*`，开发态由 electron-vite 转发到终端；
   打包产物没有终端，用户遇到问题时无法提供任何信息。
2. **中文日志在 Windows 终端显示为乱码。** 终端默认 GBK 代码页，Node 按 UTF-8 输出，
   该现象已记录在 TROUBLESHOOTING.md；文件侧需要固定 UTF-8 以避免同样的歧义。
3. **进程数量正在增加。** 主进程、任务进程（见 [task-process.md](./task-process.md)）、渲染进程，
   以及解码用的 worker 线程；日志需要汇集到单一出口。
4. **现有日志缺少级别与上下文。** 没有级别区分，也没有任务 id、模块名等结构化字段，排障依赖关键词搜索。

## 2. 目标与非目标

**目标**

1. 打包后仍有可查阅的日志文件，位置固定、编码固定；
2. 统一级别（error / warn / info / debug）与结构化字段（时间、级别、模块、任务 id）；
3. 汇集所有进程的输出，允许按文件轮转与保留；
4. 用户可一键打开日志目录或导出诊断信息。

**非目标**

- 不做远程上报或遥测；V1 不提供界面内的实时日志查看面板。

## 3. 设计

### 3.1 落点与格式

- 目录：`data/logs/`，与数据库同级（复用现有的 `getDataDir()`，开发态为 `dist/data/logs`，
  打包后为 exe 同级的 `data/logs`）；
- 文件：`app-YYYY-MM-DD.log`，UTF-8 无 BOM，LF 换行；
- 行格式（字段顺序固定，便于检索）：

```
2026-09-21 23:02:51.123 [INFO ] [scan#18] 写入图片 137/818
```

### 3.2 级别

| 级别 | 用途 |
|---|---|
| error | 功能失败、异常终止 |
| warn | 可继续但需知悉（跳过文件、回退路径） |
| info | 生命周期与关键状态（启动、任务状态跃迁、迁移执行） |
| debug | 逐单元细节，默认关闭 |

默认级别：打包态 `info`，开发态 `debug`（依据 `app.isPackaged`）；可由环境变量
（如 `PLM_LOG_LEVEL`）覆盖。

### 3.3 轮转与保留

- 跨天切换文件；单文件超过阈值时按序号续写（`app-2026-09-21.1.log`）；
- 启动时按保留策略清理（保留最近 N 个文件或 M 天）；
- 阈值与保留数量集中定义为常量。

### 3.3 多进程汇集

文件由**主进程独占写入**，其余进程只发送记录：

| 来源 | 通道 |
|---|---|
| 主进程 | 直接调用 logger |
| 渲染进程 | IPC 通道 `log:write`（限制单条长度、必要时节流） |
| 任务进程 | MessagePort 的 `log` 消息（见 task-process.md 第 5 节） |
| worker 线程 | 与宿主同进程，输出已在同一 stdout 上，由 3.4 兜底捕获 |

### 3.4 兜底捕获

- 拦截 `process.stdout.write` 与 `process.stderr.write`：既保留控制台输出，也写入文件
  （覆盖第三方库与 worker 线程的输出）；
- `process.on('uncaughtException')` 与 `process.on('unhandledRejection')`：记录后按既有策略处理；
- Electron 事件：`render-process-gone`、`child-process-gone`、`preload-error`。

### 3.5 控制台与文件的关系

开发态保留带颜色的控制台输出，文件始终不写颜色码；中文乱码只在终端出现，文件不受影响
（终端侧仍需 `chcp 65001`，TROUBLESHOOTING 已有说明）。

### 3.6 用户可见入口

- 打开日志目录（`shell.openPath`）；
- 导出诊断信息：应用版本、系统信息、最近若干行日志。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/main/log/logger.ts` | 级别、格式化、写入、轮转、保留 |
| **新增** `src/main/log/capture.ts` | stdout 与 stderr 兜底、全局异常捕获 |
| **新增** `src/main/log/ipc.ts` | 渲染进程的 `log:write` 通道 |
| `common/ipcChannels.ts` | 增加 `LOG_WRITE` |
| `src/main/index.ts` | 启动早期初始化，退出前 flush |
| 既有模块 | 将 `console.*` 替换为 logger（`database/db.ts`、`task/*`、`image/*`、`dialogs/*`） |

## 5. 风险

1. **高频日志放大磁盘 IO**：缩略图池逐张记录会显著增加写入；对策：该路径降级为 debug，
   或按数量采样。
2. **同步写入阻塞主线程**：采用追加流（异步）写入，退出时 flush；error 级别可同步落盘以避免丢失。
3. **日志含用户路径**：明确仅本地保存、不自动上报。
4. **多进程并发写同一文件**：由主进程独占写入规避。

## 6. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 自研（约 150 行）还是引入 `electron-log` | 自研；避免为该功能引入依赖 |
| 2 | 行格式：人类可读文本，还是 JSON Lines | 文本；字段顺序固定即可检索 |
| 3 | 保留策略的具体数量与天数 | 30 天或 14 个文件，取先到者 |
| 4 | 是否在界面内提供日志查看面板 | V1 不做 |
