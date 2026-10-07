# 设置页面

**状态**：进行中（骨架、主题切换与日志级别展示已落地；其余设置项见 §3.7）
**关联**：[diagnostics.md](./diagnostics.md)（打开日志目录 / 收集日志的入口落在这里）、[../design/theme.md](../design/theme.md)（主题是第一个设置项）、[open-script-in-editor.md](./open-script-in-editor.md)（默认编辑器的落点）

---

## 1. 背景

1. **现在没有任何设置入口，能调的东西全是常量或环境变量**：日志级别 `PLM_LOG_LEVEL` / `PLM_LOG_LEVEL_EXTERNAL` / `PLM_LOG_LEVEL_SCRIPT`（`src/main/log/logger.ts`），日志保留 50 MB / 20 个文件 / 14 天（同文件），相似判定阈值 `SAME_DISTANCE = 3` 与 `SIMILAR_DISTANCE = 10`（`src/main/image/similar.ts`），整库备份间隔 30 秒（`src/main/database/db.ts`）与升级前备份保留 3 份（`src/main/ups/engine.ts` 的 `BACKUP_KEEP`），解码并发与内存预算（`src/main/image/thumbnail-pool.ts`、`src/main/task/runners/scan.ts`）。
2. **一批新需求正在排队，都是「要有个开关，但没地方放」**：打开日志目录 / 收集日志（diagnostics）、默认外部编辑器（open-script-in-editor）、平铺/列表默认视图（[../design/view-layouts.md](../design/view-layouts.md)）、颜色主题（[../design/theme.md](../design/theme.md)）。逐个往现有页面塞，很快就把它们变成杂物间。
3. **环境变量对桌面应用的使用者不成立**：Windows 上要改系统环境变量、打包后没有终端、Mac/Linux 上还得开 shell；要能调就得有一个落盘、可手改、可备份的位置。
4. **用户目录已经分好四份**（`data/` `scripts/` `temp/` `logs/`），加一份 `settings.yml` 与它们同源：排障、备份、搬家时是同一套东西。
5. **从别的工具迁移过来的人对手改配置有预期**，YAML 允许注释，比 JSON 更适合「人写一次、机器偶尔改」。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-29 | 首次记录（需求登记） | 使用者提出 |
| 2026-10-07 | 评审结论与第一部分落地：YAML 用 `js-yaml`；第一版只做骨架 + 主题 + 日志级别只读展示；日志级别继续走环境变量；设置在建窗口之前读进内存 | 实施中发现的问题与取舍（见 §3.2、§3.5、§7） |

---

## 2. 目标与非目标

**目标**

1. 主窗口有一个「设置」页：分组呈现、逐项可改，改完立即生效或明确提示「需重启」。
2. 设置在 `~/.plmanager/settings.yml`（开发态 `dist/.plmanager/settings.yml`），主进程独占读写；文件坏掉、键缺失、值非法都不影响启动（退回默认值 + 一条 error 日志）。
3. 后续路线图里的开关（主题、默认编辑器、诊断入口、视图默认值）都挂在这一页，不再新开页面。
4. 手改这个文件与在界面里改等价：改完重启或下一次读取生效；未知键保留。

**非目标**

- 不做多套配置与作用域（没有 workspace 级设置）——一个用户一份；
- 不做在界面里直接编辑 YAML 原文件（界面是表单，文件只是落点）；
- 不做设置的云同步、导入导出（要做另立条目）。

## 3. 设计

### 3.1 文件与读写

- 路径 `getSettingsPath()` → `join(getUserDir(), 'settings.yml')`（`src/main/paths.ts`），与 `data/` `scripts/` `temp/` `logs/` 同级。
- **只有主进程读写**（渲染进程不许碰 fs）；写用 `writeFileAtomic()`（`src/main/script/files.ts` 的通用工具，先写临时文件再改名）。
  这是唯一一处跨模块复用：它不碰脚本语义，为它另立一个共享模块并不划算。
- 读：启动时读一次进内存，之后以内存为准；改动整份写回。写盘**串行化**（`store.ts` 的 `pending` 队列）：
  两次改动几乎同时到达时，后一次必须等前一次落定后再读快照，否则会拿旧值算新值。
- **读必须在建任何窗口之前**（`main/index.ts` 的 `bootstrap()` 里 `await initSettings()`）：窗口底色、系统按钮
  字形色与 URL 上的主题偏好都在建窗口时就定了，晚一步会先闪一下系统主题。异步读一个小文件，
  不违反「主进程不用同步 IO」。

### 3.2 YAML 解析器：定 `js-yaml`

- `js-yaml`（5.x）+ 它自带的类型声明，**不需要** `@types/js-yaml`。
- **代价：不做文档级往返**，所以手写的注释与排版会在第一次在界面上改动后被抹掉。这条写进了设置页的脚注——
  宁可写在明处，也不要让人以为自己的注释还在。
- 解析用 `loadAll` 而不是 `load`：v5 的 `load` 对空输入（空文件、只有注释的文件）直接抛错，
  而那两种都是「还没设置过什么」的合法状态。
- 多个文档：只读第一个并记一条 error——后面那些不会被写回，静默丢掉比报一条更坏。

### 3.3 校验、默认值与兼容

- 每个键一个默认值 + 一个校验器；坏值记一条 error 并用默认值，**绝不让设置挡住启动**。错误消息是英文
  （会进 `root.log`），而渲染进程提交的坏值属于输入校验，文案是中文（只上界面）。
- **未知键保留**：读时留一份原始映射，写回时合并回去——新版本写的键被旧版本打开也不会被抹掉。
- 渲染进程提交的改动只认已知键、值非法就整条拒绝（`sanitizePatch`）。

### 3.4 生效时机（每一项都要标注）

- **立即**：主题（已落地）；
- **下一次操作**：默认导出目录、默认外部编辑器；
- **需重启**：日志级别与保留策略、解码并发与内存预算——它们在启动时就被固化了。

### 3.5 启动顺序上的一个硬约束：定「日志级别不进设置页」

- `src/main/index.ts` 在最顶上就 `setupLogging()`（要能记录「开库失败」「窗口没建起来」），而级别现在来自环境变量。
  要把级别搬进 `settings.yml`，就得在配置 log4js 之前读完文件——那一次读只能是同步的。
- **结论：第一版不让设置页管日志级别**，继续用环境变量；设置页只展示「当前生效的级别 + 它来自哪里」
  （`log/logger.ts` 的 `getRootLevel()`）。这样启动路径上不出现同步 IO。

### 3.6 界面与刷新

- 入口：左侧导航的第 7 项（贴底那一组，与脚本、任务并列）；不放标题栏（标题栏留给拖拽区与系统按钮）。
- 页面现状：**界面**组（主题单选，改了立即生效）、**日志**组（级别与来源，只读），底部一行写设置文件路径
  与「手改等价、注释不保留」。
- 改动推送给所有窗口（`settings:changed`，载荷是整份设置）；主进程自己要立刻跟上的两处（窗口底色、
  系统按钮字形色）由 `settings/ipc.ts` 调 `applyWindowPalette()`。

### 3.7 进度

**已完成**

| 位置 | 内容 |
|---|---|
| `src/common/settings.ts` | 设置的类型、默认值、主题可选项与校验（两个进程共用） |
| `src/main/settings/schema.ts` | 纯文本的解析与生成：坏文件 / 缺键 / 坏值 / 未知键 / 多文档（有单测） |
| `src/main/settings/store.ts` | 内存态、原子写、写盘串行化、`nativeTheme.themeSource`、变化订阅 |
| `src/main/settings/ipc.ts` | `settings:get` / `settings:set` / `settings:changed`，两个副作用订阅者 |
| `src/renderer/views/main/SettingsPage.vue` + `services/settings-service.ts` | 设置页与调用封装；导航第 7 项与 `/settings` 路由 |
| `src/renderer/entries/shell/theme.ts`、`window-manager.ts` | 主题偏好经 `?theme=` 首帧送达、`settings:changed` 广播、窗口配色刷新（见 [../design/theme.md](../design/theme.md)） |

**剩余**

- 把现有常量搬进设置：相似判定阈值、整库备份间隔、解码并发与内存预算、升级前备份保留份数；
- 诊断的两件事（打开日志目录、收集日志）落进这一页，见 [diagnostics.md](./diagnostics.md)；
- 默认外部编辑器（[open-script-in-editor.md](./open-script-in-editor.md)）、默认视图（[../design/view-layouts.md](../design/view-layouts.md)）；
- 日志保留策略（50 MB / 20 个 / 14 天）进设置页。

## 4. 改动清单

| 位置 | 状态 | 改动 |
|---|---|---|
| **新增** `src/common/settings.ts` | 已落地 | 设置的类型、默认值、主题可选项与校验 |
| **新增** `src/main/settings/{schema,store,ipc}.ts` | 已落地 | 见 §3.7（原方案是 `{defaults,store,ipc}`：默认值与校验放 `common/` 是因为渲染进程也要用它渲染表单） |
| **新增** `src/renderer/views/main/SettingsPage.vue`、`src/renderer/services/settings-service.ts` | 已落地 | 设置页与调用封装 |
| `src/main/paths.ts` | 已落地 | `getSettingsPath()` |
| `src/common/ipcChannels.ts` | 已落地 | `settings:get` / `settings:set` / `settings:changed` |
| `src/renderer/App.vue` + 路由 | 已落地 | 导航第 7 项与路由 |
| `logger.ts` / `image/similar.ts` / `db.ts` / `thumbnail-pool.ts` / `scan.ts` | 未做 | 常量改成从设置取，保留现有默认值（日志级别按 §3.5 不进设置） |
| `docs/design/` | 落地后 | 设置项清单与每项的生效时机；本文件在剩余项做完后迁入 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 坏文件挡住启动 | 解析失败即用默认值 + 一条 error 日志（已有单测覆盖） |
| 手写注释被写回吃掉 | 已定 `js-yaml`，这条是**已知代价**，写在设置页脚注与本文件 §3.2 |
| 设置项语义分散、生效时机不一致 | 每项必须在文档与界面上标注「立即 / 下次 / 需重启」 |
| 阈值类设置被改坏（相似距离、并发数） | 校验范围；超范围退回默认并记日志 |
| 启动首读与「主进程不许同步 IO」冲突 | 定案见 §3.5：日志级别不进设置；设置用异步读、在建窗口之前 |

## 6. 验证方法

1. 纯逻辑（已做）：`test/main/settings/schema.test.ts` 覆盖空文件、只有注释、坏 YAML、根不是映射、
   坏值、未知键保留、序列化往返、提交内容校验——用临时文本，不需要 Electron。
2. 人工冒烟（待做）：改一项立即生效的（主题，四个窗口都要看）、改一项需重启的（日志级别只读展示）、
   手改文件后重启、故意写坏文件确认还能启动、连点两次确认最后一次生效。

## 7. 待决事项

| # | 事项 | 结论 |
|---|---|---|
| 1 | YAML 解析器 | 加 `js-yaml`；注释不保留是已知代价（§3.2） |
| 2 | 日志级别进设置页还是继续环境变量 | 继续环境变量，设置页只展示当前值与来源（§3.5） |
| 3 | 设置页入口 | 导航第 7 项（§3.6） |
| 4 | 写回时是否保留手写注释 | 不保留，写进界面脚注与文档 |
| 5 | 文件不存在时是否落一个带注释的默认文件 | 不主动创建，界面里改第一项时再写 |
| 6 | 第一版的设置项范围 | 骨架 + 主题（唯一可改项）+ 日志级别只读；其余见 §3.7 的剩余 |
