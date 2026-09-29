# 路线图

本目录收录**尚未开始或正在进行**的功能方案，一个功能一个文件，文件名使用 kebab-case 且与功能同名。

功能落地后，将文件中的状态改为 `已实施` 并补上提交号，然后 `git mv` 到 [../design/](../design/) 作为该子系统的设计说明。
本目录只保留尚未完成的事项——已完成的文档不删除，只是换个地方继续被读。

- 结构性说明（目录为何如此划分）见 [ARCHITECTURE.md](../ARCHITECTURE.md)
- 代码与目录的硬性约定见 [AGENTS.md](../../AGENTS.md)
- 各层文档的分工与边界见 [文档地图](../README.md)

本目录只回答三个问题：做什么、为什么、怎么做。

## 事项

| 主题 | 状态 | 文件 |
|---|---|---|
| 任务独立进程与全任务断点续跑 | 待实施 | [task-process.md](./task-process.md) |
| 任务剩余耗时估算 | 待实施 | [task-eta.md](./task-eta.md) |
| 诊断：打开日志目录与收集日志 | 待评审 | [diagnostics.md](./diagnostics.md) |
| 用本机编辑器打开脚本 | 待评审 | [open-script-in-editor.md](./open-script-in-editor.md) |
| 脚本库：互相引用、外部依赖与补全跳转 | 待评审 | [script-library.md](./script-library.md) |
| 设置页面 | 待评审 | [settings-page.md](./settings-page.md) |
| 颜色主题切换 | 待评审 | [theme.md](./theme.md) |
| 平铺视图 | 待实施 | [view-layouts.md](./view-layouts.md) |
| 相似图片管理 | 待评审 | [similar-manage.md](./similar-manage.md) |
| 其余窗口的自绘标题栏 | 待评审 | [window-chrome.md](./window-chrome.md) |
| 测试系统 | 待评审 | [test-system.md](./test-system.md) |
| 构建目标：32 位与 arm 架构 | 待评审 | [build-targets.md](./build-targets.md) |
| 开源就绪 | 待评审 | [open-source-readiness.md](./open-source-readiness.md) |

## 状态取值

| 状态 | 含义 |
|---|---|
| 待评审 | 已写出初稿，方案尚未评审 |
| 待实施 | 方案已定，尚未改动代码 |
| 进行中 | 已开工；文件内记录已完成到哪一步 |
| 已实施 | 代码已合入；补上提交号 |
| 已放弃 | 决定不做；写明原因后删除文件 |
