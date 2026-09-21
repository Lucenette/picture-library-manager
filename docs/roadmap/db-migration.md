# 数据库版本升级

**状态**：待评审（初稿，方案尚未评审）
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md) 的「数据库与持久化」一节、
[task-process.md](./task-process.md)（需要新增 `task` 表的两列）

---

## 1. 背景

1. **现有建表方式只对新库有效。** `DDL_ALL` 全部为 `CREATE TABLE IF NOT EXISTS`，
   已存在的库不会被改动。
2. **存在破坏性兼容逻辑。** `ensureTaskTable()` 以列名判断是否为旧结构，命中即执行 `DROP TABLE task`。
   该分支一旦被真实用户触发，任务历史即丢失。
3. **已发生的实际需求。** `thumbnail` 由 TEXT 改为 BLOB、新增 `phash` 列，两次都是在开发机上手工执行
   `ALTER TABLE` 完成的；用户端的旧库无法自动升级。路线图中的 [task-process.md](./task-process.md)
   还要为 `task` 表新增 `cursor` 与 `attempts`。
4. 结论：需要可重复、可审计、失败可恢复的迁移机制。

## 2. 目标与非目标

**目标**

1. 结构变更以「版本化迁移」表达，按序执行，可重复且可审计；
2. 每个迁移在独立事务内执行，失败即回滚并中止启动，不产生半升级状态；
3. 升级前自动备份，可人工恢复；
4. 旧库（无版本记录但有表）能被正确识别为基线，不重放建表语句；
5. 数据库版本高于应用时拒绝启动，避免旧版本写入新结构。

**非目标**

- 不实现 down migration（SQLite 的 DDL 能力有限，回滚由备份恢复承担）；
- 不抽象多数据库方言（本项目的存储固定为 SQLite）。

## 3. 设计

### 3.1 版本记录

- 审计表作为唯一事实来源（对应 Liquibase 的 DATABASECHANGELOG）：

```sql
CREATE TABLE IF NOT EXISTS schema_migration (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

- `PRAGMA user_version` 作为快速路径缓存；启动时若与审计表的最高 id 不一致，以审计表为准并纠正。

### 3.2 迁移定义

```ts
interface Migration {
  id: number;
  name: string;
  /** 在事务内执行；抛错即整体回滚 */
  up(db: DatabaseSync): void;
}

const MIGRATIONS: readonly Migration[] = [ /* ... */ ];
```

规则：已应用的迁移不得修改（由 checksum 拦截）；迁移只增不改；id 唯一。

### 3.3 执行流程

在 `initDatabase()` 内、创建窗口之前执行：

1. 打开数据库；
2. 读取当前版本（审计表最高 id，缺省取 `PRAGMA user_version`）；
3. 若库中已有业务表但无版本记录，则认定为基线：写入 baseline 审计行，但不重放创建语句；
4. 依次执行 id 大于当前版本的迁移，每个迁移一个事务；
5. 写入审计行并更新 `user_version`；
6. 继续启动流程。

失败处理：该迁移回滚，版本不变，启动中止，并在日志与界面上给出迁移 id 与错误原因；
升级前备份保留，供人工恢复。

### 3.4 升级前备份

- 迁移开始前复制数据库到 `data/backups/pre-migration-v<旧版本>-<时间戳>.db`，保留最近若干份；
- 与现有 `.bak` 机制区分：`.bak` 是运行期兜底（30 秒节流），`backups/` 专用于版本升级。

### 3.5 表重建辅助

SQLite 不支持修改列类型，标准流程为「新建表 → 复制数据 → 删除旧表 → 改名 → 重建索引」，
且必须位于同一事务内。抽为 `rebuildTable(db, table, newDdl, columns)`；
`thumbnail` 改 BLOB 时已手工执行过一次，可直接固化为第一个使用者。

### 3.6 拒绝降级

库内最高迁移 id 大于应用内置的 MIGRATIONS 最高 id 时，提示「数据库由更新版本的应用创建」，
并拒绝启动（至少拒绝写入）。

### 3.7 与唯一写者的关系

迁移只在启动阶段执行，此时主窗口与任务进程均未启动，不存在并发写入。

## 4. 需要补录的迁移

| id | 名称 | 内容 |
|---|---|---|
| 1 | baseline | 由 `DDL_ALL` 生成的初始结构（仅新建库执行） |
| 2 | task 表结构对齐 | 取代 `ensureTaskTable()` 的 DROP，改为保留数据的重建 |
| 3 | image_file.thumbnail 改为 BLOB | 补录已手工执行的变更 |
| 4 | image_file.phash | 同上 |
| 5 | task.cursor 与 task.attempts | 见 [task-process.md](./task-process.md) |

历史库的现状由基线认定，避免重复执行。

## 5. 风险

1. **迁移写错会破坏用户库** → 升级前强制备份、事务包裹、失败中止。
2. **大库迁移耗时**（重建表、VACUUM）→ 启动阶段同步执行；耗时较长时给出明确提示。
3. **版本记录不一致** → 以审计表为准并自动纠正，同时记录一条 warn 日志。
4. **开发态与打包态路径不同** → 统一复用 `getDataDir()`。
5. **`DDL_ALL` 与 baseline 重复维护** → 由 `DDL_ALL` 生成 baseline，保持单一来源。

## 6. 验证方法

1. 空库启动：版本等于最高 id，schema 与 `DDL_ALL` 一致（比对 `PRAGMA table_info`）。
2. 旧版库启动：补上缺失迁移；抽查数据行数与关键字段。
3. 人为让某迁移抛错：该迁移回滚、版本不变、启动中止、备份存在。
4. 库版本高于应用：拒绝启动并给出明确提示。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 审计表与 `user_version` 双轨，还是只保留其一 | 审计表为事实来源，`user_version` 仅作缓存 |
| 2 | 是否需要 down migration | 不需要，由备份恢复承担 |
| 3 | 升级前备份的保留份数 | 5 份 |
| 4 | 是否将 `DDL_ALL` 与 baseline 合并为单一来源 | 合并，DDL_ALL 作为 baseline 的输入 |
