# 事故 0002：升级脚本里再开事务会撞 SQLite

## 执行摘要

迁移引擎已经开好事务，`postups` 又调了一个自带 `beginBatch`（内部发 `BEGIN`）的函数，SQLite 直接报 `cannot start a transaction within a transaction`，升级停在第 5/5 步。根因是两处入口各自发 `BEGIN`、没有共享嵌套计数；修法是让迁移事务也占用那个计数，脚本里的 `beginBatch`/`endBatch` 退化成嵌套。账本把这一步记成 `failed` 而不是 `executed`，所以重启即从 `postups` 续跑。

## 现象

升级走到第 5/5 步（`postups`）抛 SQLite 错误 `cannot start a transaction within a transaction`，整轮升级中止。

## 影响

升级中断在收尾步骤。数据没有损坏——前三步（接管旧脚本与三条 changeSet）都已提交，账本也如实记下这一步失败，重启即可继续。

## 时间线

| 时间 | 事件 |
|---|---|
| 2026-09-27 | `renameScript()` 在 `postups` 里触发嵌套事务，升级停在第 5/5 步 |
| 2026-09-27 | 提交 `57fe125` 修复：`runInMigrationTransaction()` 占用同一嵌套计数；核对账本记 `failed`、重启续跑 |

## 根因

事务有两个入口——迁移引擎的 `runInMigrationTransaction()` 与脚本/业务用的 `beginBatch()` / `endBatch()`——各自决定要不要发 `BEGIN`，彼此不知道对方。`postups` 调用的 `renameScript()` 用 `beginBatch` 保证「改名 + 图库名字副本」原子，于是在已有事务里又发了一次 `BEGIN`。

## 补上的守卫

- `runInMigrationTransaction()` 也占用嵌套计数器 `batchDepth`：升级脚本里的 `beginBatch` / `endBatch` 退化成嵌套，不再发第二个 `BEGIN` / `COMMIT`。
- 账本区分 `failed` 与 `executed`：失败的那一步重启后会重跑，成功过的不再执行。
- [design/ups.md](../design/ups.md) §3.9 写明脚本的约束：不要自己写 `BEGIN` / `COMMIT`。
- [.agents/skills/commit-convention](../../.agents/skills/commit-convention/SKILL.md) 把它当作「修复类」提交信息的范例。

## 教训

- **两个事务入口等于一个必须共享的计数器。** 「已经在事务里」应当是引擎的事实，而不是脚本作者的约定。
- **失败要能续跑，而不是只能回滚。** 把进度写进账本、把失败标成 `failed`，这次事故的恢复动作才只是重启。
