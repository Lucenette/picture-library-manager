# 日志系统

**状态**：待实施
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)、[TROUBLESHOOTING.md](../TROUBLESHOOTING.md)、[diagnostics.md](./diagnostics.md)（日志的打开与收集，另立）

---

## 1. 背景

1. **打包后没有任何日志。** 主进程的输出现阶段全部经 `console.*`，开发态由 electron-vite 转发到终端；打包产物没有终端，使用者遇到问题时无法提供任何信息，也无法复盘。
2. **中文日志在 Windows 终端显示为乱码**（终端默认 GBK，Node 按 UTF-8 输出）。文件侧必须固定 UTF-8，避免同样的歧义。
3. **进程数量在增加**：主进程、渲染进程、解码用的 worker 线程，将来还有任务进程（见 [task-process.md](./task-process.md)）。日志需要汇集到单一出口。
4. **现有输出缺级别与上下文**：没有级别区分，没有进程与模块字段，排障只能靠关键词搜索。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次定稿：实现用 log4js；三个日志文件；控制台始终开且带来源；消息一律英文 ASCII | — |

---

## 2. 目标与非目标

**目标**

1. 打包后仍有可查阅的日志文件：位置与编码固定、按天滚动、旧文件压缩保留。
2. 统一 API（占位符形式）与四个级别，行内含时间、级别、进程与模块。
3. 汇集主进程、渲染进程、worker 线程；用户脚本与第三方的输出各有一个独立文件。
4. 控制台始终有输出、带来源，开发时能直接看出哪条来自我们的代码、哪条来自用户脚本、哪条来自第三方。
5. 兜住我们没主动记录的输出：第三方库、Electron 事件、未捕获异常。

**非目标**

- 不做远程上报或遥测；不做界面内的实时日志面板；日志的「打开目录 / 收集」另立路线图（见 diagnostics.md）。

## 3. 设计

### 3.1 落点与滚动

- 目录：`~/.plmanager/logs/`（开发态 `dist/logs/`），由 `paths.ts` 新增 `getLogsDir()` 派生。
- 三个文件：`root.log`（我们自己的日志）、`external.log`（第三方与噪声输出）、`script.log`（用户脚本里 `console.*` 的输出）。三者的滚动、压缩与保留规则完全一致。
- 按天滚动，旧文件重命名并压缩（`root.log.2026-09-28.gz`）；**50 MB 是压缩前的单文件上限**（纯文本压缩后很小），超过时在当天内继续分卷。
- 保留三条上限：单文件 50 MB、按天 14 天、**最多 20 个文件**。实测（log4js 6.9）：`numBackups: 20` 生效，且把当天的分卷一起计入——300 次分卷后正好是「热文件 + 20 个 `.gz`」；**`daysToKeep` 只是 `numBackups` 的弃用别名**（streamroller 里直接把前者赋给后者），按文件数计、不按日期，所以「14 天」这条由**我们在启动时清理**：扫 `*.gz`，按修改时间删掉超过 14 天的。
- 文件名规则：`pattern` 不能带前导点（带了会出现 `root.log..2026-09-29.gz` 这种双点），用 `pattern: 'yyyy-MM-dd'` + 默认分隔符即得 `root.log.2026-09-29.gz`。
- 编码固定 UTF-8、LF；**消息文本一律英文 ASCII**（变量值本身可以是非 ASCII，例如中文路径），避免终端、文件与工具链之间的编码歧义。

### 3.2 实现与依赖

- 用 **log4js**（`^6.9.1`，已由使用者安装）：轮转、压缩、保留、异步写、`log4js.shutdown()` 齐备，纯 JS 无原生依赖，打包无障碍。
- **只用 log4js 自带的 layout**，不写自定义 layout 函数：文件用 `pattern`，控制台开发态用 `colored`、打包态用 `basic`。
- **控制台始终开着**（开发与打包一样：使用者有时用命令行运行，终端日志更直观）。开发态着色；打包态不着色——log4js 的 `colored` 不探测 TTY，重定向或管道里会留下转义码，所以按「是否打包」静态切换，而不是按 TTY 判断。
- **三个来源都进控制台**：用户脚本的日志是使用者调试的唯一窗口；第三方的输出我们也要在开发时看得见。来源由 category 显示（见 3.3）。
- **级别可配**：`PLM_LOG_LEVEL`（`root`，默认开发态 `debug`、打包态 `info`）、`PLM_LOG_LEVEL_EXTERNAL` 与 `PLM_LOG_LEVEL_SCRIPT`（后两者默认 `warn`）。log4js 原生支持按 category 设级别。
- 文件侧套一层 `logLevelFilter` 只收 INFO 及以上（避免 debug 把 50 MB 撑满）；控制台不受这条限制。
- 沿用参考实现的一条做法：渲染进程经 IPC 汇总到主进程，文件只有一个写者。

### 3.3 category 与行格式

category 同时承担「来源 + 进程角色 + 模块」三件事，log4js 自带的 layout 会用 `%c` 把它打印出来：

| category | 去处 | 例子 |
|---|---|---|
| `main.<模块>` | `root.log` | `main.scan`、`main.library` |
| `renderer.<模块>` | `root.log` | `renderer.editor` |
| `external.<来源>` | `external.log` | `external.stdout`、`external.console-main`、`external.console-renderer` |
| `script` | `script.log` | 用户脚本里的 `console.*` |

文件行格式（`pattern` layout）：

```
2026-09-28 23:02:51.123 WARN  [12345] [main.library] failed to take over legacy script
2026-09-28 23:02:52.008 DEBUG [28164] [renderer.editor] rendering group 137/818
```

- 字段：`时间(毫秒) 级别(5 宽) [pid] [category] 消息`。
- **不记文件与行号**：打包态它们指向 bundle（第 5 节风险 1），而模块已由 category 承担；打包态的定位靠 category 与消息文本。
- 控制台沿用 log4js 自带 layout 的样子（`[时间] [级别] category - 消息`），于是控制台上直接看得到来源：`main.*` / `renderer.*` 是我们的日志，`script` 是用户脚本，`external.*` 是第三方。

### 3.4 API

```ts
const log = createLogger('scan');        // main 进程 → main.scan；渲染进程 → renderer.scan
log.warn('failed to process file, taskId: {}, code: {}', taskId, code);
log.debug('wrote image {}/{}', done, total);
```

- 占位符 `{}` 按顺序替换；参数多于占位符时忽略多余项，少于占位符时保留原样（便于发现拼错）。
- 级别过滤在拼装**之前**短路（`isLevelEnabled`），debug 关闭时不付字符串拼接的成本。
- 模块名只用于拼 category，不单独进行内。

### 3.5 多来源汇集

| 来源 | 通道 | 去处 |
|---|---|---|
| 主进程 | 直接调用封装 | `root.log`（`main.*`）+ 控制台 |
| 渲染进程 | 自己的封装（API 与主进程一致）+ IPC 汇总 | `root.log`（`renderer.*`）+ 控制台 |
| worker 线程 | 同一封装，运输层改为 `postMessage`，由宿主（缩略图池）转给主进程 | `root.log` + 控制台 |
| 用户脚本 | 执行期间 `stdout` / `stderr` 分流 | `script.log` + 控制台 |
| 第三方与噪声 | `stdout` / `stderr` 补丁与渲染进程的 `console-message` | `external.log` + 控制台 |

文件由主进程独占写入；其余来源只发送记录，不自己开文件。

### 3.6 兜底

- 补 `process.stdout.write` / `process.stderr.write`：原输出照旧，同时往 `external` 类别记一条。**必须做重入保护**：日志自己写控制台时置位旁路，否则开发态的 `console` appender 会被再抓一次、同一行进两个文件（这也是「补丁与 log4js 是否兼容」的答案：兼容，但保护不可省）。
- 渲染进程的 `webContents.on('console-message')`：框架警告、Vue 的提示、第三方输出 → `external.console-renderer`。
- **用户脚本的 `console.*`**：在 `executeScript()` 执行期间置一个「当前通道 = script」的标记，`stdout` / `stderr` 补丁据此把这期间的输出写进 `script.log`（同时也进控制台）。脚本调用期间是同步执行，标记不会串台；脚本若把 `console` 存下来异步打印，那类输出会落回常规通道。
- `process.on('uncaughtException')` / `unhandledRejection`：记 error 进 `root.log` 并落盘后再按既有策略处理。
- Electron 的 `render-process-gone`、`child-process-gone`、`preload-error`：进 `root.log`（它们是我们的诊断依据，不是第三方噪声）。
- `bootstrap()` 的 catch 也要先写日志再弹原生错误框（现在那条路径除了弹框什么都不留）。

### 3.7 初始化与退出

- 在 `src/main/index.ts` 顶部初始化（早于 `configureCommandLine()` 与 `initDatabase()`）：它要能记录「开库失败」「窗口没建起来」。
- 因此它**不能**登记成加载服务的任务（加载服务自己还在初始化它）；这是启动顺序里唯一的例外，代码注释与本文写明理由，避免后人按约定改回去。
- 退出：`before-quit` 先 `log4js.shutdown()` 再关库（dateFile 是异步写，文档明确要求在进程结束时调用）。

### 3.8 可测性

- 占位符替换放在 `src/common/log.ts`：纯函数、不依赖 electron、不依赖 log4js，可在沙箱里用 `node` 直接跑断言。
- log4js 的配置（三个文件、滚动与保留、category 与级别）可以在沙箱里用临时目录跑真实代码验证，不需要 electron。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/common/log.ts` | 级别类型、占位符替换（纯函数） |
| **新增** `src/main/log/logger.ts` | log4js 配置（三个文件、控制台、category 与级别）、封装、运输层 |
| **新增** `src/main/log/capture.ts` | `stdout` / `stderr` 补丁（重入保护 + 通道标记）、全局异常、Electron 事件、`console-message` |
| **新增** `src/main/log/index.ts` | 早期初始化、退出 flush、对外导出 |
| **新增** `src/renderer/services/log-service.ts` | 渲染进程侧封装（IPC 汇总） |
| `src/common/ipcChannels.ts` | 新增 `LOG_WRITE` |
| `src/main/paths.ts` | 新增 `getLogsDir()` |
| `src/main/index.ts` | 顶部初始化；`before-quit` 里 flush；`bootstrap()` 的 catch 先写日志 |
| 既有模块 | 21 处 `console.*` 换成封装（`task/runners/scan.ts` 5、`ups/engine.ts` 4、`database/db.ts` 3、`window-manager.ts` 2、`image/thumbnail-sharp.ts` 2，其余各 1，含渲染进程 2 处），**消息一并改写成英文** |
| `src/main/image/thumbnail-worker.ts` + `thumbnail-pool.ts` | worker 日志经 `postMessage` 交给宿主 |
| `src/main/script/script-service.ts` | 执行用户脚本期间置「当前通道 = script」，其 `console.*` 落 `script.log` 并进控制台 |
| `docs/TROUBLESHOOTING.md` | 新增一节：三个日志文件在哪、怎么打开、怎么读 |
| `AGENTS.md` | 用户目录那行加 `logs/`；补「日志消息一律英文 ASCII」与「日志用封装、不直接 `console`」 |
| `docs/ARCHITECTURE.md` | 主进程模块表加 `log/` |
| `CHANGELOG.md` | `[未发布]` 加一条（面向使用者） |

## 5. 风险

1. **打包态没有文件行号可读。** electron-vite 把主进程打成 `out/main/index.js`，渲染进程也是打包后的 chunk，行号只在开发态与源码一一对应。因此行内不带文件与行号（决策如此），打包态靠 category 与消息文本定位；要更细只能另配 sourcemap 映射，V1 不做。
2. **stdout 补丁可能自我递归或被异步写绕过**：靠重入置位 + 同步落盘保证，实施时专门测一次。
3. **50 MB / 天在 debug 下会被撑满**：文件侧固定 INFO 及以上，debug 只出现在控制台。
4. **控制台会变吵**：用户脚本与第三方的输出都进控制台是刻意的，但第三方噪声可能很多；级别可配（`PLM_LOG_LEVEL_EXTERNAL` / `PLM_LOG_LEVEL_SCRIPT`），必要时调高。
5. **日志含用户路径**：仅本地保存、不自动上报；diagnostics 里的「收集日志」需要使用者显式导出。

## 6. 验证方法

1. 纯函数：`src/common/log.ts` 的占位符替换，在沙箱里用 `node` 跑断言（参数过多 / 不足）。
2. log4js 配置：用临时目录跑真实配置，确认三个文件名、滚动后的重命名与压缩、`daysToKeep` / `numBackups` 的实际清理行为、category 与级别过滤（这一步在沙箱里就能做，不需要 electron）。
3. 静态检查：`tsc` / `vue-tsc` / `node scripts/check-docs.mjs`。
4. 需要使用者冒烟：打包态确实生成日志；关窗后最后几行不丢；人为触发一次未捕获异常与一次渲染进程报错，确认都进了文件；用户脚本里 `console.log` 出现在 `script.log` 与控制台。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 两个附属文件的名字 | `external.log` 与 `script.log`（备选 `third-party.log` / `user-script.log`） |
| 2 | 「14 天」的清理时机 | 启动时清一次；长跑不重启的极端情况不在覆盖内，V1 接受 |
| 3 | `external` 的默认级别是否够用 | 先 `warn`；被噪声淹没或漏掉关键提示时再调 `PLM_LOG_LEVEL_EXTERNAL` |
