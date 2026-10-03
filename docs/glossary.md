# 术语表

一行一条，给第一次读代码或文档的人定位概念；每条指向它的权威文档——**定义不在多处重复**。

## 领域

| 术语 | 含义 | 归属 |
|---|---|---|
| 来源 | 一个可扫描的目录（网络盘或本地盘） | [README.md](../README.md) |
| 图库 | 某次扫描按来源汇总出的图片集合 | [README.md](../README.md) |
| 图组 | 扫描时按子目录归并出的分组 | [README.md](../README.md) |
| 脚本 | 用户目录 `scripts/` 下的 `.js` 文件，编译后在主进程执行 | [SCRIPTING.md](./SCRIPTING.md) |
| 角色 / 方法 | 脚本声明的导出类型与它识别、处理的对象 | [SCRIPTING.md](./SCRIPTING.md) |
| 缩略图 | 存库的 100×100 WebP 字节，进查看器与平铺视图时用 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 感知哈希 | 缩略图解码时顺带算出的相似度指纹 | [ARCHITECTURE.md](./ARCHITECTURE.md) |

## 任务与进程

| 术语 | 含义 | 归属 |
|---|---|---|
| 任务 | 扫描 / 选图 / 导出 / 相似识别的一次执行，带状态机与进度 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| runner | 某一类任务的执行体，只在单元边界调用检查点 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 检查点 | runner 让出控制权、响应取消的位置 | [AGENTS.md](../AGENTS.md) |
| 工作线程 | 承载缩略图解码这类不可打断的重计算 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 加载服务 | 启动阶段任务的登记与调度：谁阻塞、谁预热、跑在哪个进程 | [design/loading.md](./design/loading.md) |
| essential / warmup | 加载服务的两类任务：前者跑完才进主界面，后者与必需任务并行、失败只记日志 | [design/loading.md](./design/loading.md) |

## 数据与升级

| 术语 | 含义 | 归属 |
|---|---|---|
| changeSet | `dbups.xml` 里一条带 `id` 的变更，账本按身份记账、只执行一次 | [design/ups.md](./design/ups.md) |
| 版本目录 | `src/main/ups/changesets/<版本>/`，最多含 preups / dbups / postups 三件 | [design/ups.md](./design/ups.md) |
| 账本 | `schema_migration` 表，记录已执行的 changeSet 与脚本；执行过的不再执行 | [design/ups.md](./design/ups.md) |
| 排序键 | 把中文（拼音）、数字（自然序）与标点算成可直接比较的字符串 | [design/sort-keys.md](./design/sort-keys.md) |
| 数据目录 / 缓存目录 | `~/.plmanager/data` 与 `cache`；前者是库与备份，后者可随时删 | [AGENTS.md](../AGENTS.md) |

## 界面

| 术语 | 含义 | 归属 |
|---|---|---|
| 自绘标题栏 | 主窗口没有系统标题栏，单独的 `.title-bar` 就是它 | [design/window-management.md](./design/window-management.md) |
| WCO | Window Controls Overlay，Windows / Linux 上保留系统窗口按钮的方式 | [design/window-management.md](./design/window-management.md) |
| 列表视图 / 平铺视图 | 图库与图组管理的两种布局；平铺不分页、滚到底续取 | [design/view-layouts.md](./design/view-layouts.md) |
| 日志三分 | `root.log`（应用）、`external.log`（第三方）、`script.log`（用户脚本） | [design/logging.md](./design/logging.md) |

## 尚未落地

| 术语 | 含义 | 归属 |
|---|---|---|
| 命令总线 | 用一条通道抽象同时承载 IPC 与 HTTP + WebSocket，core 与渲染进程不感知差别 | [roadmap/headless-server.md](./roadmap/headless-server.md) |
