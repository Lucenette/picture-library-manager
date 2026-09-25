# 数据库版本升级

**状态**：已实施（提交 57595bd）
**最后更新**：2026-09-26

---

## 1. 背景

1. **现有建表方式只对新库有效。** `DDL_ALL` 全部是 `CREATE TABLE IF NOT EXISTS`，已存在的库不会被改动。
2. **存在破坏性兼容逻辑。** `ensureTaskTable()` 以列名判断是否为旧结构，命中即执行 `DROP TABLE task`。
   该分支一旦被触发，任务历史即丢失。
3. **已经手工改过两次结构。** `thumbnail` 由 TEXT 改为 BLOB、新增 `phash` 列，两次都是在开发机上手工执行
   `ALTER TABLE` 完成的；用户端的旧库无法自动升级。后续还要为 `task` 表新增 `cursor` 与 `attempts` 两列，
   同样会碰到这个问题。
4. 结论：需要一套可重复、可审计、失败可回滚的库结构演进机制。

### 1.1 修改历史

记录本文档的修订。

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-24 | 首次定稿 | — |
| 2026-09-26 | 删掉已兑现的前置条件与落地改动清单；改正一处与 3.7 矛盾的启动顺序 | 落地后文档该写现状，不写落地过程 |

---

## 2. 目标与非目标

**目标**

1. 结构变更与数据订正都以「版本化的 changeset」表达，按顺序执行，可重复、可审计；
2. 每条 changeset 在独立事务内执行：失败即回滚、之前成功的保留，中断后能从下一条接着来；
3. 执行前自动备份，可人工恢复；
4. 主窗口启动时先落在加载页，有变更就展示进度，完成后自动切回主界面；
5. 库中记录了本应用不认识的 changeset 时给出提示，避免旧版本写入新结构。

**非目标**

- 声明式变更标签（`<createTable>`、`<addColumn>` 等）：只支持 `<sql>`；
- down migration：恢复到备份；
- 需要图片解码或文件 IO 的补数据：由任务系统承担。

## 3. 设计

### 3.1 格式

每个版本文件是一份语法合法的 Liquibase changelog，但只使用其中四个元素：

| 元素 | 作用 |
|---|---|
| `<databaseChangeLog>` | 根元素 |
| `<changeSet id author>` | 一条 changeset，`id` 与 `author` 参与构成它的身份 |
| `<comment>` | 这条 changeset 的标题：写进账本，也在加载页上展示 |
| `<sql>` | 要执行的 SQL，原样交给 SQLite |

遇到其它标签、或 `<sql>` 带任何属性，一律报错。

XML 正文里只有 `<` 与 `&` 需要转义，写成 `&lt;` 与 `&amp;`；引号只在属性值里才需要，`>` 在正文里合法。
**这两条由写 changelog 的人保证，解析器不做校验**：漏写 `<` 可能报错，也可能被 XML 当成标签吞掉。

```xml
<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">
  <changeSet id="20260924173105937842" author="powerinv">
    <comment>task 表新增 cursor 与 attempts</comment>
    <sql>
      ALTER TABLE task ADD COLUMN cursor TEXT NOT NULL DEFAULT '';
      ALTER TABLE task ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
    </sql>
  </changeSet>
</databaseChangeLog>
```

### 3.2 目录与文件

```
src/main/database/
  db.ts                统一入口：开库、CRUD、DB 的 IPC 调度、启动时调用迁移
  sql.ts               运行时 CRUD 语句；不再包含任何建表语句
  changeset.ts         引擎：解析、账本、计划、执行、备份
  changeset-ipc.ts     迁移页的 IPC 与进度推送
  changesets/
    1.0.0.xml           1.0.0 引入的结构
    index.ts            版本文件清单
```

**文件名取 `package.json` 里的版本号**，因此一个版本最多一个文件，一眼能看出某个结构是哪一版引入的。
`sql.ts` 里的 `DDL_ALL` 与全部 `CREATE_*` 常量一并删除：schema 的唯一来源是这些 changelog。
清单只列文件名，一行一个，顺序与版本号递增一致：

```ts
import v1 from './1.0.0.xml?raw';

export const CHANGELOG_FILES: readonly ChangeLogFile[] = [
  { filename: '1.0.0', content: v1 },
];
```

`env.d.ts` 声明了 `*?raw` 模块，changelog 因此以字符串形式进包，构建期不需要额外的文件读取。

**规矩：开发期间往当前版本的文件末尾追加 `<changeSet>`；该版本发布后文件冻结，后续结构变更写进新版本
的文件。** 账本按身份记账，改一条已经执行过的 changeset 不生效——它会被判定为已跑过而跳过。

### 3.3 身份与顺序

身份是 Liquibase 的三元组 `(author, id, filename)`，例如 `(powerinv, 20260924173105937842, 1.0.0)`。

`id` 是 20 位定长数字：`yyyyMMddHHmmss`（14 位）+ 毫秒（3 位）+ 随机数（3 位），按时间递增。

执行顺序由两处显式决定：清单数组的顺序 → 文件内 `<changeSet>` 的文档顺序。

### 3.4 解析

使用 `@xmldom/xmldom`（W3C DOM 接口，零依赖；在 `package.json` 里是显式依赖，不依赖传递依赖）。
解析器接上 `onError` 并抛错：它的默认行为是记一条日志后继续，返回的可能是半个文档。

除「缺 `id` / `author` / `<sql>`」以外不做校验——这三样缺了就没法构成一条能记账的 changeset，
其余语法与转义由写 changelog 的人负责。

### 3.5 账本

```sql
CREATE TABLE IF NOT EXISTS schema_migration (
  author         TEXT    NOT NULL,   -- 'powerinv'
  id             TEXT    NOT NULL,   -- '20260924173105937842'
  filename       TEXT    NOT NULL,   -- '1.0.0'
  title          TEXT    NOT NULL,
  exectype       TEXT    NOT NULL CHECK(exectype IN ('executed','failed')),
  order_executed INTEGER NOT NULL,
  applied_at     TEXT    NOT NULL,
  execution_ms   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (author, id, filename)
);
```

- 「跑过没有」**按身份判断**：表里有这个三元组就是跑过，没有就是没跑过；
- 失败行在回滚**之后**另开事务写入：它活得下来，下次启动能看见上次是怎么炸的，但不会被误判为已执行；
- 「检查过、无需改动」这种结果不落库，凡是没记过的就执行。

### 3.6 执行流程

在 `initDatabase()` 之后、加载页切回主界面之前：

1. 建账本表，读出已执行集合；
2. 按顺序算出待执行的 changeset；
3. 有待执行时，先推一条进度（当前步骤记为「正在备份数据库」）——备份要复制整个库，不能让它空着；
   然后 `PRAGMA wal_checkpoint(TRUNCATE)`，把数据库复制到
   `data/backups/pre-migration-<yyyyMMdd-HHmmss>.db`，保留最近 5 份。备份写不出来就中止；
4. 逐条执行：`BEGIN` → `db.exec(这条的 sql 文本)` → 写账本 → `COMMIT`；抛错则 `ROLLBACK` →
   记一行 `failed` → 停止；
5. 每条之间让出一次事件循环（`await setImmediate`），让加载页有机会先画出来；同时检查主窗口是否已被关闭，
   已关闭就立即收手；
6. 进度 = 已完成的 changeset 数 / 总数，由主进程算好后推送。

`db.exec()` 一次可执行多条语句，因此一条 changeset 就是一段文本，不做分号切分。

**边界**：changeset 只做集合式 SQL 与表结构变更；逐行、需要解码或文件 IO 的补数据（例如 phash
回填）仍归任务系统。

### 3.7 启动加载页

主窗口一律先落在 `/loading`：

- 主窗口排在开库与注册通道**之前**：窗口的显示、渲染进程的启动、changelog 的执行三者重叠。
  开库与注册通道合计十几毫秒，且都是同步代码，排在第一个 `await` 之前——渲染进程发来的 invoke 要等
  主进程回到事件循环才会被派发，所以先建窗口再注册通道不存在竞态。
- 启动流程只有一条路径，不需要预先判断有没有待执行的 changeset。正常启动时状态要么还没到、要么已是终态，
  页面什么都不画，所以不会闪出加载页。
- 页面显示进度条、当前 changeset 的标题、已完成与总数；失败时显示错误原因与备份路径，并提供「退出」。
- 主进程推送 `CHANGESET_PROGRESS`；渲染进程挂载时先订阅推送、再 `invoke(CHANGESET_STATE)` 取一次快照，
  因此「升级比页面加载还快」时也能拿到终态。
- 读到终态后用 `router.replace('/')` 切回主界面——是 replace 不是 push，加载页不会留在历史里，后退键回不去。
- 升级期间关掉窗口即退出应用：`before-quit` 会关库，正在执行的那条 changeset 随事务回滚。

### 3.8 什么会停下，什么不会

| | 情形 |
|---|---|
| **会停下**（加载页显示错误） | changelog 解析失败、缺少 `id` / `author` / `<sql>`、SQL 执行报错、备份写不出来 |
| **只提示**（`console.warn`，照常继续） | 账本里有当前代码不认识的身份（可能是降级到旧版本）、待执行的 changeset 排在已执行的之前（往已发布文件的中间插了东西） |

### 3.9 与唯一写者的关系

迁移只在启动阶段执行，此时只有加载页窗口、其它进程也未启动，不存在并发写入。
这也是对后续任何新增进程的约束：它们必须在主进程完成迁移之后才能打开数据库。

## 4. 风险

1. **迁移写错会破坏库** → 执行前强制备份、事务包裹、失败回滚。
2. **大库建表或表重建耗时** → 在启动阶段执行，由迁移页给出进度，不阻塞界面。
3. **XML 转义遗漏** → 漏写 `&` 是解析错误，漏写 `<` 可能被当成标签吞掉；解析器不校验这两条（见 3.1），由写 changelog 的人负责。
4. **本次之前手工改过结构的库不会被修复** → 属已知代价，见第 6 节。
5. **解析器默认不抛错** → 必须接 `onError`，否则错误会变成静默的不完整 SQL。

## 5. 验证方法

1. **静态检查**：`tsc -p tsconfig.node.json`、`vue-tsc -p tsconfig.web.json`、用 `@vue/compiler-sfc` 编译新页面、
   用 AST 检查控制语句大括号、确认 `@/` 与 `@common/` 路径可解析、渲染进程不得引用 Node 内置模块。
2. **脚本验证**：引擎不依赖 electron，可在纯 Node 24 下直接加载（`node:sqlite` 与 SQLite 3.53.3 已实测可用）。
   用本机数据库副本验证零写入；用空库验证建出的结构与现有 DDL 逐列一致；用畸形 XML 验证两条硬性检查；
   用非法 SQL 验证回滚与 `failed` 行；连续执行验证备份轮转。
3. **人工冒烟**（静态检查通过不等于功能正常）：首次启动应看到迁移页并在 `data/backups/` 留下备份；
   再次启动不应出现迁移页；人为写错一条 SQL，确认失败页显示错误与备份路径。

## 6. 已知代价

| # | 事项 | 说明 |
|---|---|---|
| 1 | 手工改过结构的旧库不在本次修复范围 | 本机库已是最终结构，无需迁移；账本自本次建立，此后不会再出现这种局面 |
