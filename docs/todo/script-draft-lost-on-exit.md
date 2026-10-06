# 脚本未保存的改动在关闭应用后会丢

**状态**：待办
**关联**：[script-management.md](../design/script-management.md)

## 背景

编辑器把未保存的改动写进用户目录的草稿（`temp/scripts/`），落盘时机是 1 秒防抖、窗口失焦与页面卸载（`src/renderer/views/main/ScriptPage.vue` 的 `DRAFT_DEBOUNCE_MS` 与 `flushDraft()`）。

用户实际遇到：编辑脚本、没有按 Ctrl+S，直接关闭应用再打开，上次的改动被回退。疑似原因：直接关窗口时渲染进程随窗口销毁，`onBeforeUnmount` 里那句 `void flushDraft()` 是异步的（渲染进程经 IPC 调主进程的 `putScriptDraft`），往往来不及完成；不到 1 秒防抖的改动就跟着丢了。需要先实测确认是「flush 没跑完」还是「卸载钩子根本没执行」。

## 事项

- 关窗/退出前保证当前草稿落盘，不要只靠页面卸载钩子：可由主进程在关闭前请求渲染进程 flush 并等回执，或把落盘提前到每次输入（缩短或去掉防抖窗口）。
- 复现：编辑脚本 → 1 秒内直接关窗口 → 重开应用 → 看是否回退。
- 验证：关窗后重开，最后一次输入仍在；`temp/scripts/` 下能看到对应草稿。
