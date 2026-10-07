# 浅色下脚本状态栏的问题数没有颜色

**状态**：待办
**关联**：[theme.md](../design/theme.md)

## 背景

脚本编辑器状态栏右下角的「无问题 / N 个问题」用 `--el-color-success-light-2` 与 `--el-color-danger-light-2` 上色（`src/renderer/views/main/scripts/ScriptEditor.vue` 的 `.status-problem` 与 `.has-problem`）。

实测：这两个色阶只有暗色主题给值（`src/common/theme/dark.ts`），浅色主题不覆盖（`light.ts` 只给 `--app-*` 与少数 `--el-*`），于是浅色下落到 Element Plus 的浅色默认值，在浅色状态栏底上几乎看不见。同一行其它状态文字用 `--el-text-color-secondary`（`theme.css` 已映射到 `--app-*`），不受影响。

## 事项

- 改用明暗两套都有的 `--app-*` 语义色：`--app-success` / `--app-danger`，或标签文字色 `--app-tag-success-text` / `--app-tag-danger-text`。
- 复现：系统切到浅色（默认跟随系统），打开脚本管理页看右下角。
- 验证：浅色与暗色下「无问题」为可读的绿、「N 个问题」为可读的红。
