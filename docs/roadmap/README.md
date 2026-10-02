# 路线图

本目录收录**尚未开始或正在进行**的功能方案，一个功能一个文件，文件名使用 kebab-case 且与功能同名。

功能落地后，将文件中的状态改为 `已实施` 并补上提交号，然后 `git mv` 到 [../design/](../design/) 作为该子系统的设计说明。
本目录只保留尚未完成的事项——已完成的文档不删除，只是换个地方继续被读。

- 结构性说明（目录为何如此划分）见 [ARCHITECTURE.md](../ARCHITECTURE.md)
- 代码与目录的硬性约定见 [AGENTS.md](../../AGENTS.md)
- 各层文档的分工与边界见 [文档地图](../README.md)

本目录只回答三个问题：做什么、为什么、怎么做。

## 事项

| 主题 | 状态 | 难度 | 涉及 | 文件 |
|---|---|---|---|---|
| 任务独立进程与全任务断点续跑 | 待实施 | 高 | 主进程 + 任务进程 + IPC + 数据库 | [task-process.md](./task-process.md) |
| 任务剩余耗时估算 | 待实施 | 低 | 主进程 + IPC | [task-eta.md](./task-eta.md) |
| 诊断：打开日志目录与收集日志 | 待评审 | 低 | 主进程 + 渲染进程 | [diagnostics.md](./diagnostics.md) |
| 用本机编辑器打开脚本 | 待评审 | 中 | 主进程 + 渲染进程 | [open-script-in-editor.md](./open-script-in-editor.md) |
| 脚本库：互相引用、外部依赖与补全跳转 | 待评审 | 高 | 主进程 + 渲染进程（需先评审） | [script-library.md](./script-library.md) |
| 设置页面 | 待评审 | 中 | 主进程 + 渲染进程（需先评审：要加 YAML 依赖） | [settings-page.md](./settings-page.md) |
| 颜色主题切换 | 待评审 | 低 | 渲染进程 + 主进程窗口底色 | [theme.md](./theme.md) |
| 相似图片管理 | 待评审 | 中 | 主进程 + 渲染进程 + 数据库（需先评审） | [similar-manage.md](./similar-manage.md) |
| 相似图片识别的语义加强（CLIP + sqlite-vec） | 待评审 | 高 | 主进程 + 任务系统 + 数据库 + 原生依赖（需先评审） | [similar-semantic.md](./similar-semantic.md) |
| 其余窗口的自绘标题栏 | 待评审 | 中 | 渲染进程 + 主进程窗口配置 | [window-chrome.md](./window-chrome.md) |
| 构建目标：32 位与 arm 架构 | 待评审 | 低 | 构建配置（需先核实 Electron 与 sharp 的架构支持） | [build-targets.md](./build-targets.md) |
| Electron 依赖剥离与无头 server 模式 | 待评审 | 高 | 主进程 + 渲染进程 + 构建配置 | [headless-server.md](./headless-server.md) |
| 视觉素材与 LoRA 训练流水线 | 待评审 | 高 | 主进程 + 任务系统 + 数据库 + 原生依赖（需先评审） | [visual-training-pipeline.md](./visual-training-pipeline.md) |

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
