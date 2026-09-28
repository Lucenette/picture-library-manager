# 日志系统

**状态**：待实施
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)、[TROUBLESHOOTING.md](../TROUBLESHOOTING.md)、[diagnostics.md](./diagnostics.md)（日志的打开与收集，另立）

---

## 1. 背景

1. **打包后没有任何日志。** 主进程的输出现阶段全部经 `console.*`，开发态由 electron-vite 转发到终端；打包产物没有终端，使用者遇到问题时无法提供任何信息，也无法复盘。
2. **中文日志在 Windows 终端显示为乱码**（终端默认 GBK，Node 按 UTF-8 输出）。文件侧必须固定 UTF-8，避免同样的歧义。
3. **进程数量在增加**：主进程、渲染进程、解码用的 worker 线程，将来还有任务进程（见 [task-process.md](./task-process.md)）。日志需要汇集到单一出口。
4. **现有输出缺级别与上下文**：没有级别区分，没有文件行号、进程与业务字段，排障只能靠关键词搜索。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次定稿：评审确定实现（log4js）、格式（英文 ASCII，含进程、模块与文件行号）、保留策略（50 MB / 14 天 / 20 个文件）、三个日志文件的分工与控制台策略 | — |

---

## 2. 目标与非目标

**目标**

1. 打包后仍有可查阅的日志文件：位置与编码固定、按天滚动、旧文件压缩保留。
2. 统一 API（占位符形式）与四个级别，行内含时间、级别、进程、文件行号。
3. 汇集主进程、渲染进程、worker 线程；文件由主进程独占写入。
4. 兜住我们没主动记录的输出：第三方库、Electron 事件、未捕获异常。

**非目标**

- 不做远程上报或遥测；不做界面内的实时日志面板；日志的「打开目录 / 收集」另立路线图（见 diagnostics.md）。

## 3. 设计

### 3.1 落点与滚动

- 目录：`~/.plmanager/logs/`（开发态 `dist/logs/`），由 `paths.ts` 新增 `getLogsDir()` 派生。
- 三个文件：`root.log`（我们自己的日志）、`external.log`（第三方与噪声输出）、`script.log`（用户脚本里 `console.*` 的输出）。三者的滚动、压缩与保留规则完全一致。
- 当前文件固定叫这两个名字；按天滚动，旧文件重命名并压缩（`root.log.2026-09-28.gz`），**50 MB 是压缩前的单文件上限**（纯文本压缩后很小），超过时在当天内继续分卷。
- 保留策略三条上限：单文件 50 MB、按天 14 天、**最多 20 个文件**。按天的 `daysToKeep` 是直通 streamroller 的选项（log4js 的 TypeScript 类型里没有它，类型里有的是按文件数计的 `numBackups`）；`numBackups` 是否把当天的分卷算进去**要实测**——算不进去就在启动时自己兜一层「按修改时间删到只剩 20 个」的清理，保证上限成立。
- 编码固定 UTF-8、LF；**消息文本一律英文 ASCII**（变量值本身可以是非 ASCII，例如中文路径），避免终端、文件与工具链之间的编码歧义。

### 3.2 实现与依赖

- 用 **log4js**（`^6.9.1`）：轮转、压缩、保留、异步写、`log4js.shutdown()` 齐备，是纯 JS 无原生依赖，打包无障碍。
- **依赖已就位**：使用者已执行 `yarn add log4js`，当前为 `6.9.1`（仓库约定：代理不自行安装依赖）。
- **控制台输出始终开着**（开发与打包都一样：使用者有时用命令行运行，终端日志更直观）。着色用**自定义 layout**：`process.stdout.isTTY` 为真时给行内的级别字段上 ANSI 颜色，否则原样输出——log4js 自带的 `colored` layout 不探测 TTY（会往管道里吐转义码），而且它自带 `[时间] [级别] category -` 前缀，跟我们自拼的整行重复。文件侧一律纯文本 layout、并套 `logLevelFilter` 只收 INFO 及以上（避免 debug 把 50 MB 撑满）。
- **级别可配**：`PLM_LOG_LEVEL`（`root`，默认开发态 `debug`、打包态 `info`）、`PLM_LOG_LEVEL_EXTERNAL` 与 `PLM_LOG_LEVEL_SCRIPT`（后两者默认 `warn`）。log4js 原生支持按 category 设级别，不需要自己写过滤。
- 沿用参考实现的一条做法：渲染进程经 IPC 汇总到主进程，文件只有一个写者。
- **`external.log` 与 `script.log` 的内容都不进控制台**：第三方输出本来就已经出现在终端或 DevTools，再转一次就是重复。

### 3.3 行格式

```
2026-09-28 23:02:51.123 WARN  [main 12345] [library] library.ts:210 failed to take over legacy script
2026-09-28 23:02:52.008 DEBUG [renderer 28164] [editor] editor.ts:88 rendering group 137/818
```

- 字段顺序：`时间(毫秒) 级别(5 宽) [进程角色 pid] [模块] 文件:行 消息`。
- 进程角色取 `main` / `renderer` / `worker`（将来的 `task`）；pid 由各进程自己上报。
- 模块来自 `createLogger('scan')`。它同时是 log4js 的 category（用于级别控制），也是打包态的主要定位维度——那里的文件:行会退化成产物位置（见第 5 节风险 1）。
- **文件:行由封装自取**（跳过封装内部帧），行与消息一起交给 log4js 落盘。log4js 自己也有 `%f`/`%l`，并为封装层留了跳过帧数的 `callStackLinesToSkip`（`lib/logger.js`）；但渲染进程的记录是经 IPC 到主进程落盘的，主进程那侧的调用点会是 IPC 处理器，所以三个进程统一自取，顺带也不必打开 log4js 的 `enableCallStack`。
- **整行由我们拼装**，log4js 只负责落盘与滚动（layout 用 `%m`）。这样格式与占位符可在纯 Node 下断言，也不受 log4js 调用点解析的约束。

### 3.4 API

```ts
const log = createLogger('scan');
log.warn('failed to process file, taskId: {}, code: {}', taskId, code);
log.debug('wrote image {}/{}', done, total);
```

- 占位符 `{}` 按顺序替换；参数多于占位符时忽略多余项，少于占位符时保留原样（便于发现拼错）。
- 级别过滤在拼装**之前**短路（`isLevelEnabled`），debug 关闭时不付调用点与字符串拼接的成本。
- 文件:行取自调用点（跳过封装内部帧）；`renderer` 侧同样取自己的调用点，随记录一起发给主进程。

### 3.5 多来源汇集

| 来源 | 做法 |
|---|---|
| 主进程 | 直接调用封装，底层写 log4js |
| 渲染进程 | 自己的封装（API 与主进程一致）+ IPC 汇总到主进程；**额外用 `webContents.on('console-message')` 兜住**框架警告与第三方输出 |
| worker 线程 | 同一封装，运输层改为 `postMessage`，由宿主（缩略图池）转给主进程 |
| 第三方与噪声 | 落到单独的 `external.log`：独立 appender、与 `root.log` 相同的滚动与保留规则；**默认只收 warn 及以上**（可用 `PLM_LOG_LEVEL_EXTERNAL` 放宽）；来源见 3.6 |
| 用户脚本 | 脚本里的 `console.*` 落到单独的 `script.log`，规则同上；默认同样只收 warn 及以上，可配 |

文件由主进程独占写入；其余来源只发送记录，不自己开文件。

### 3.6 兜底

- 补 `process.stdout.write` / `process.stderr.write`：原输出照旧，同时往 `external` 类别记一条（落 `external.log`）。**必须做重入保护**：日志自己写控制台时置位旁路，否则开发态的 `console` appender 会被再抓一次、同一行进两个文件（这也是「补丁与 log4js 是否兼容」的答案：兼容，但保护不可省）。
- 渲染进程的 `webContents.on('console-message')`：框架警告、Vue 的提示、第三方输出 → `external.log`。
- **用户脚本的 `console.*`**：在 `executeScript()` 执行期间置一个「当前通道 = script」的标记，stdout/stderr 补丁据此把这期间输出写进 `script.log`。脚本在调用期间同步执行，标记不会串台；脚本若把 `console` 存下来异步打印，那种输出会落回常规通道。
- `process.on('uncaughtException')` / `unhandledRejection`：记 error 进 `root.log` 并落盘后再按既有策略处理。
- Electron 的 `render-process-gone`、`child-process-gone`、`preload-error`：进 `root.log`（它们是我们的诊断依据，不是第三方噪声）。
- `bootstrap()` 的 catch 也要先写日志再弹原生错误框（现在那条路径除了弹框什么都不留）。

### 3.7 初始化与退出

- 在 `src/main/index.ts` 顶部初始化（早于 `configureCommandLine()` 与 `initDatabase()`）：它要能记录「开库失败」「窗口没建起来」。
- 因此它**不能**登记成加载服务的任务（加载服务自己还在初始化它）；这是启动顺序里唯一的例外，代码注释与本文写明理由，避免后人按约定改回去。
- 退出：`before-quit` 先 `log4js.shutdown()` 再关库（dateFile 是异步写，文档明确要求在进程结束时调用）。

### 3.8 可测性

- 占位符替换与行拼装放在 `src/common/log.ts`：纯函数、不依赖 electron、不依赖 log4js，可在沙箱里用 `node` 直接跑断言。
- 主进程侧只留「配置 log4js、运输层、兜底捕获」三件与运行环境相关的事。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/common/log.ts` | 级别类型、占位符替换、行拼装（纯函数） |
| **新增** `src/main/log/logger.ts` | log4js 配置与封装、调用点解析、运输层 |
| **新增** `src/main/log/capture.ts` | stdout/stderr 补丁（带重入保护）、全局异常、Electron 事件 |
| **新增** `src/main/log/index.ts` | 初始化、退出 flush、对外导出 |
| **新增** `src/renderer/services/log-service.ts` | 渲染进程侧封装（IPC 汇总） |
| `src/common/ipcChannels.ts` | 新增 `LOG_WRITE` |
| `src/main/paths.ts` | 新增 `getLogsDir()` |
| `src/main/index.ts` | 顶部初始化；`before-quit` 里 flush |
| 既有模块 | 21 处 `console.*` 换成封装（`task/runners/scan.ts` 5、`ups/engine.ts` 4、`database/db.ts` 3、`window-manager.ts` 2、`image/thumbnail-sharp.ts` 2，其余各 1，含渲染进程 2 处），**消息一并改写成英文** |
| `src/main/image/thumbnail-worker.ts` + `thumbnail-pool.ts` | worker 日志经 `postMessage` 交给宿主 |
| `src/main/script/script-service.ts` | 执行用户脚本期间置「当前通道 = script」，其 `console.*` 落 `script.log` |
| `docs/TROUBLESHOOTING.md` | 新增一节：日志在哪、怎么打开、怎么读 |
| `AGENTS.md` | 用户目录那行加 `logs/`；「改完必须自检」无需改动 |
| `docs/ARCHITECTURE.md` | 主进程模块表加 `log/` |
| `CHANGELOG.md` | `[未发布]` 加一条（面向使用者） |

## 5. 风险

1. **文件:行在打包态指向打包产物。** electron-vite 把主进程打成 `out/main/index.js`，渲染进程也是打包后的 chunk，因此行号只在开发态与源码一一对应；打包态要配合构建产物（或另配 sourcemap）才能回溯。**V1 接受，并在 TROUBLESHOOTING 里写明；打包态靠模块名与消息文本定位。**
2. **逐行取调用点有成本**（每次解析一次栈）。级别短路在前（`isLevelEnabled`），只有真的要写日志时才解析；debug 在打包态默认关闭，且不打开 log4js 的 `enableCallStack`（避免第二遍解析）。
3. **stdout 补丁可能自我递归或被异步写绕过**：靠重入置位 + 同步落盘保证，实施时专门测一次。
4. **50 MB / 天在 debug 下会被撑满**：文件侧固定 INFO 及以上（参考实现同款做法），debug 只进开发态控制台。
5. **日志含用户路径**：仅本地保存、不自动上报，diagnostics 里的「收集日志」需要使用者显式导出。

## 6. 验证方法

1. 纯函数：`src/common/log.ts` 的占位符与行格式，在沙箱里用 `node` 跑断言（含参数过多/不足、级别短路）。
2. log4js 配置：用临时目录跑一次，确认当前文件名、滚动后的重命名与压缩，以及 `daysToKeep` / `numBackups` 的实际清理行为（这一步在沙箱里就能做，不需要 electron）。
3. 静态检查：`tsc` / `vue-tsc` / `node scripts/check-docs.mjs`。
4. 需要使用者冒烟：打包态确实生成日志；关窗后最后几行不丢；人为触发一次未捕获异常与一次渲染进程报错，确认都进了文件。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 打包态的文件:行怎么处理 | V1 接受指向打包产物，文档写明；不做 sourcemap 映射 |
| 2 | 两个附属文件的名字 | `external.log` 与 `script.log`（备选 `third-party.log` / `user-script.log`） |
| 3 | 「最多 20 个文件」怎么落地 | 先试 `numBackups: 20`；它若不算当天分卷，就在启动清理里自己兜一层 |
| 4 | `external` 的默认级别是否够用 | 先 `warn`；被噪声淹没或漏掉关键提示时再调 `PLM_LOG_LEVEL_EXTERNAL` |
