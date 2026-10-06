# 待办事项

本目录收录**工程性待办**：不构成功能方案、但需要记住"有什么欠账、卡在谁身上、什么条件下能解开"的事。与 [../roadmap/](../roadmap/) 平级——那里放功能方案，这里放这类收尾项。

一个事项一个文件，文件名 kebab-case。事项办完就删掉对应条目或整个文件（历史在 git 里，这里不保留）。

**与 AGENTS.md 那条「AI 或工具的临时工作状态（待办清单）不进版本库」不冲突**：那条管的是会话内的临时清单；这里记的是**跨会话的工程欠账**——上游放开某条限制之前，谁都需要知道"为什么依赖停在这个版本、机器人为什么被屏蔽"。

其它各层的分工见 [文档地图](../README.md)。

## 当前事项

| 事项 | 状态 | 卡在谁 | 文件 |
|---|---|---|---|
| 被上游卡住的依赖升级 | 等上游 | `typescript-eslint` 的 peer 上限、`electron-vite` 的 Vite peer 上限 | [blocked-upgrades.md](./blocked-upgrades.md) |
| 脚本未保存改动在关闭应用后会丢 | 待办 | 无 | [script-draft-lost-on-exit.md](./script-draft-lost-on-exit.md) |
| 浅色下脚本问题数没有颜色 | 待办 | 无 | [script-problem-color-light.md](./script-problem-color-light.md) |
| 平铺视图悬停放大被裁、无阴影 | 待办 | 无 | [tile-view-hover-clip.md](./tile-view-hover-clip.md) |
| 平铺/列表切换按钮尺寸优化 | 待办 | 无 | [view-switch-button-size.md](./view-switch-button-size.md) |

## 状态取值

| 状态 | 含义 |
|---|---|
| 待办 | 随时可做，只是还没排上 |
| 等上游 | 依赖上游发版或放开限制，现在做不了 |
| 待清理 | 当初为绕过某问题留下的临时物，条件满足后应删除 |
