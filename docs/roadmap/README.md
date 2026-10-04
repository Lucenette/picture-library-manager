# 路线图

本目录收录**尚未开始或正在进行**的功能方案，一个功能一个文件，文件名使用 kebab-case 且与功能同名。

功能落地后，将文件中的状态改为 `已实施` 并补上提交号，然后 `git mv` 到 [../design/](../design/) 作为该子系统的设计说明。
本目录只保留尚未完成的事项——已完成的文档不删除，只是换个地方继续被读。

- 结构性说明（目录为何如此划分）见 [ARCHITECTURE.md](../ARCHITECTURE.md)
- 代码与目录的硬性约定见 [AGENTS.md](../../AGENTS.md)
- 各层文档的分工与边界见 [文档地图](../README.md)

本目录回答：做什么、为什么、怎么做，以及每个事项排在哪一版（见下表）。

## 事项与版本计划

版本号怎么走，规则见 [gitflow-release](../../.agents/skills/gitflow-release/SKILL.md)：**develop 的 `package.json` 版本号就是下一次 release 的版本号**；一次 release 收尾时按是否发布推进——发布了（在 master 打了 `v<版本>` tag）下一版 `x.(y+1).0`；只 release 没发布下一版 `x.y.(z+1)`；升 `x` 由维护者另行显著告知，不随日常推进。

现在的位置：`package.json` 是 `1.1.2`，最近一个 tag 是 `v1.0.0`（`1.1.0` 与 `1.1.1` 都只 release 没发布）——**下一次 release 是 `1.1.2`**，它会带上 `1.1.0` 与 `1.1.1` 已累积的用户可见改动（脚本管理页、平铺视图、日志系统、拼音排序、分页取数）；发布后按规则进 `1.2.0`，只 release 不发则进 `1.1.3`。

下表按「计划版本 → 难度」排序，是**当前排序，不是承诺**：事项能不能开工由 `状态` 决定；某一版只 release 没发布时，版本号会先落成补丁号（如 `1.2.1`），不影响顺序。

| 计划版本 | 主题 | 状态 | 难度 | 涉及 | 文件 |
|---|---|---|---|---|---|
| `1.2.0` | 任务剩余耗时估算 | 待实施 | 低 | 主进程 + IPC | [task-eta.md](./task-eta.md) |
| `1.2.0` | 诊断：打开日志目录与收集日志 | 待评审 | 低 | 主进程 + 渲染进程 | [diagnostics.md](./diagnostics.md) |
| `1.2.0` | 颜色主题切换 | 待评审 | 低 | 渲染进程 + 主进程窗口底色 | [theme.md](./theme.md) |
| `1.3.0` | 构建目标：32 位与 arm 架构 | 待评审 | 低 | 构建配置（需先核实 Electron 与 sharp 的架构支持） | [build-targets.md](./build-targets.md) |
| `1.3.0` | 用本机编辑器打开脚本 | 待评审 | 中 | 主进程 + 渲染进程 | [open-script-in-editor.md](./open-script-in-editor.md) |
| `1.3.0` | 设置页面 | 待评审 | 中 | 主进程 + 渲染进程（需先评审：要加 YAML 依赖） | [settings-page.md](./settings-page.md) |
| `1.3.0` | 相似图片管理 | 待评审 | 中 | 主进程 + 渲染进程 + 数据库（需先评审） | [similar-manage.md](./similar-manage.md) |
| `1.3.0` | 其余窗口的自绘标题栏 | 待评审 | 中 | 渲染进程 + 主进程窗口配置 | [window-chrome.md](./window-chrome.md) |
| `2.0.0` | Electron 依赖剥离与无头 server 模式 | 待评审 | 高 | 主进程 + 渲染进程 + 构建配置 | [headless-server.md](./headless-server.md) |
| `2.x 之后` | 任务独立进程与全任务断点续跑 | 待实施 | 高 | 主进程 + 任务进程 + IPC + 数据库 | [task-process.md](./task-process.md) |
| `2.x 之后` | 脚本库：互相引用、外部依赖与补全跳转 | 待评审 | 高 | 主进程 + 渲染进程（需先评审） | [script-library.md](./script-library.md) |
| `2.x 之后` | 相似图片识别的语义加强（CLIP + sqlite-vec） | 待评审 | 高 | 主进程 + 任务系统 + 数据库 + 原生依赖（需先评审） | [similar-semantic.md](./similar-semantic.md) |
| `2.x 之后` | 视觉素材与 LoRA 训练流水线 | 待评审 | 高 | 主进程 + 任务系统 + 数据库 + 原生依赖（需先评审） | [visual-training-pipeline.md](./visual-training-pipeline.md) |

分组理由：`1.2` / `1.3` 小步发布，低难度先发、拿到反馈再往上加；`2.0.0` 要动目录结构与构建目标，且是训练流水线服务化的前提，单独作为一次 `x` 升级（由维护者宣布）；高难度且跨层的事项排在 2.x 之后——现在塞进 1.x 只会把发布拖成一个长期大版本。

## 状态取值

| 状态 | 含义 |
|---|---|
| 待评审 | 已写出初稿，方案尚未评审 |
| 待实施 | 方案已定，尚未改动代码 |
| 进行中 | 已开工；文件内记录已完成到哪一步 |
| 已实施 | 代码已合入；补上提交号 |
| 已放弃 | 决定不做；写明原因后删除文件 |
## 标签映射

`难度` 与 `涉及` 两列决定 GitHub 上的标签，方便按能力筛选可认领的条目：

| 取值 | 标签 |
|---|---|
| 难度 低 | `good first issue` |
| 明显想找人接手 | `help wanted` |
| 涉及主进程 / 任务 / IPC / 数据库 | `area:main` |
| 仅渲染进程 | `area:renderer` |
| 仅文档 | `area:docs` |
| 构建、打包、CI、依赖 | `area:build` |

`bug` / `enhancement` / `dependencies` 由 GitHub 上 Issue 的类型决定，`dependabot` 已在用后两个。
