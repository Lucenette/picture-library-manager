# 设计说明

本目录收录**已经落地**的子系统的设计说明：结构为什么是这样、有哪些不变量、改动时要注意什么。
尚未实施的方案在 [../roadmap/](../roadmap/)；进程模型与分层的总览在 [../ARCHITECTURE.md](../ARCHITECTURE.md)。

一个子系统一个文件（kebab-case），格式与路线图一致：开头是状态与背景，下面是方案正文。
文档在路线图阶段写就，落地后 `git mv` 到这里继续被读——**不重写、不删除**，历史由 git 记录。

| 主题 | 文件 |
|---|---|
| 窗口管理：成本模型、可见性、按需加载、浮窗宿主 | [window-management.md](./window-management.md) |
| 数据库结构升级：版本化 changelog + 账本 | [db-migration.md](./db-migration.md) |
