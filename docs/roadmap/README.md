# 路线图

本目录收录**尚未开始或正在进行**的功能方案，一个功能一个文件，文件名使用 kebab-case 且与功能同名。

功能落地后，将文件中的状态改为 `已实施` 并补上提交号；文件保留在原处，历史由 git 记录。

- 结构性说明（目录为何如此划分）见 [ARCHITECTURE.md](../ARCHITECTURE.md)
- 代码与目录的硬性约定见 [AGENTS.md](../../AGENTS.md)

本目录只回答三个问题：做什么、为什么、怎么做。

## 事项

| 主题 | 状态 | 文件 |
|---|---|---|
| 任务独立进程与全任务断点续跑 | 待实施 | [task-process.md](./task-process.md) |
| 任务剩余耗时估算 | 待实施 | [task-eta.md](./task-eta.md) |
| 日志系统 | 待评审 | [logging.md](./logging.md) |
| 数据库版本升级 | 待实施 | [db-migration.md](./db-migration.md) |
| 平铺视图 | 待评审 | [view-layouts.md](./view-layouts.md) |
| 相似图片管理 | 待评审 | [similar-manage.md](./similar-manage.md) |

## 状态取值

| 状态 | 含义 |
|---|---|
| 待评审 | 已写出初稿，方案尚未评审 |
| 待实施 | 方案已定，尚未改动代码 |
| 进行中 | 已开工；文件内记录已完成到哪一步 |
| 已实施 | 代码已合入；补上提交号 |
| 已放弃 | 决定不做；写明原因后删除文件 |
