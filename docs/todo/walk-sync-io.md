# 读取图片目录时窗口拖动受阻（严重）

**状态**：待办
**关联**：[file-watch.md](../roadmap/file-watch.md)（fs 层收口那条，目标 5 已把同步 I/O 一起算进去）、[AGENTS.md](../../AGENTS.md)（运行时约定第 2 条：主进程不许长时间霸占主线程）

## 背景

实际表现（使用者报告，2026-10-08）：来源目录在网络盘上时，扫描一开始窗口拖动就明显受阻，同时 CPU 接近 0、网络占满。遍历这一层用的是同步 API：

- `src/main/image/walk.ts:13` 从 `fs` 导入 `readdirSync` / `statSync`
- 同文件 `:64`、`:103` 用 `readdirSync` 读目录，`:77`、`:116` 用 `statSync` 逐个条目取类型
- 这两个函数由扫描任务在主进程里直接 await（`buildDirTree()` / `collectImageFiles()`）

同步调用返回之前事件循环没有机会跑，所以 `step()` 里那句 `setImmediate` 救不了它——分片只在两个让出点之间有效，而每次 readdir/stat 本身就是一次几十毫秒的网络往返。同文件读图片头已经走异步（`image-size/fromFile`），是这三处漏了。

不是网络盘才有的问题：目录大、盘慢时同样会卡，只是网络盘上每次调用的代价被放大到肉眼可见。

## 事项

- `buildDirTree()` 与 `collectImageFiles()` 的 `readdirSync` / `statSync` 换成 `fs.promises` 的 `readdir` / `stat`；`readdir(dir, { withFileTypes: true })` 可以省掉一次 stat，需要 `fileSize` 时再补。
- `step()` 的分片与 `YIELD_EVERY` 保留，但阈值可以重估：异步之后让出的意义变成「别一次排太多微任务」，不再是挽救阻塞。
- 复现：来源目录指向网络盘（SMB），开始扫描，拖动窗口。
- 验证：网络盘下扫描时窗口可正常拖动；扫描到的文件条数与修改前一致；`test/main/image/walk.test.ts` 仍绿。
- 机械守卫：收口后给 ESLint 加一条「`src/main` 不得直接调用 `fs` 的 \*Sync」，把这批调用一起清掉。现有违规除本文件外还有 `log/logger.ts:226`、`database/db.ts:170,191`、`task/runners/export.ts:25,55,58`。
