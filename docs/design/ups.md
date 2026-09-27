# 升级模块 ups：版本目录、升级脚本与账本

**状态**：现行架构
**最后更新**：2026-09-27

---

## 1. 背景

1. **早期建表方式只对新库有效。** `DDL_ALL` 全是 `CREATE TABLE IF NOT EXISTS`，已存在的库不会被改动；还有一段按列名判断旧结构后 `DROP TABLE task` 的兼容逻辑，一旦触发任务历史即丢。
2. **手工改过结构的库无法自动升级。** 用户端的旧库停在旧结构上，只能人工 `ALTER TABLE`。
3. 结论：需要一套可重复、可审计、失败可回滚的库结构演进机制——版本化的 changelog + 账本 + 逐条事务 + 升级前备份 + 加载页进度。
4. **只有 SQL 时，两类事写不出来**：「先把旧数据落成文件再删列」这类要动文件的步骤没有载体；「插入默认数据」只能挂在启动流程里每次启动查一遍库，没有「这一版只做一次」的表达方式。
5. **升级后来不只管数据库**：它要写数据目录里的文件、要按三段编排、要自己发进度。于是从 `database/` 独立成 `ups/` 模块，`database/` 降为它的下层。

### 1.1 修改历史

记录本文档的修订。

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-24 | 首次定稿 | — |
| 2026-09-26 | 删掉已兑现的前置条件与落地改动清单；改正一处与启动顺序矛盾的描述 | 落地后文档该写现状，不写落地过程 |
| 2026-09-27 | 由 `db-migration.md` 改名为 `ups.md`，并把路线图里那份同名方案合并进来（合并后路线图那份删掉）：版本目录（preups.ts / dbups.xml / postups.ts）、脚本记账、异常与事务、模块分层与启动顺序、备份清理 | 升级不再只是数据库的事；一个子系统只留一份文档 |

---

## 2. 目标与非目标

**目标**

1. 结构变更、数据订正与文件操作都以「版本目录里的步骤」表达，按顺序执行，可重复、可审计；
2. 每一步在独立事务内执行：失败即回滚、之前成功的保留；**脚本抛错时它写进数据库的东西一条不留**；
3. 执行前自动备份数据库，并且每次启动清理旧备份；
4. 主窗口启动时先落在加载页，有变更就展示进度，完成后自动切回主界面；
5. 库中记录了本应用不认识的步骤时给出提示，避免旧版本写入新结构。

**非目标**

- 声明式变更标签（`<createTable>`、`<addColumn>` 等）：`<sql>` 是唯一载体；down migration 也不做，恢复靠备份。
- 步骤之间的依赖编排：就是 preups → dbups → postups 三段顺序执行。
- 框架替脚本备份文件：脚本要改或删文件，自己先备份（见 3.9）。
- 需要图片解码的补数据：仍归任务系统。

## 3. 设计

### 3.1 格式

`dbups.xml` 是一份语法合法的 Liquibase changelog，但只使用其中四个元素：

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

### 3.2 模块与目录

```
src/main/ups/                 升级模块（上层）
  index.ts                    initUps()：登记给加载服务的一项任务（报进展、失败抛错）
  engine.ts                   引擎：解析、计划、执行、备份与清理；不依赖 electron
  changesets/
    index.ts                  版本清单：只 import 各版本目录的 index.ts
    1.0.0/  index.ts + dbups.xml
    1.1.0/  index.ts + preups.ts        ← dbups.xml 与 postups.ts 按需，都可以没有
src/main/database/            数据库模块（下层）
  db.ts                       建数据目录、开库（没有就建文件）、CRUD、账本读写、DB 通道
  sql.ts                      运行时 SQL 常量（含账本语句）
```

数据库模块向升级模块暴露的全部能力就是 `MigrationStore` 那六个函数：`getDataDir`、`getDbPath`、`execSql`、`runInMigrationTransaction`、`readMigrationLedger`、`writeMigrationLedger`。依赖方向是单向的：`ups → database`，`database` 里不出现 `@/ups`，所以升级脚本 import `@/database/db` 也不会成环。

### 3.3 清单与身份

- 每个版本目录的 `index.ts` 里写死 `VERSION` 并导出 `changelog`；外层 `changesets/index.ts` 只 import 各版本目录的 `index.ts`，不碰 XML 与脚本。
- **版本号取自代码里的常量，与目录名无关**：目录改名不会改变账本身份。清单顺序即执行顺序。
- 清单里出现两个相同 `version` 时直接抛错：复制版本目录忘了改 `VERSION` 会让新版本的 changeSet 顶用旧版本的身份，被账本判定为已执行而静默跳过。
- **一次例外**：`1.1.0` 的目录名与 `package.json` 都是 1.1.0（这一版做的是 minor：脚本文件库、加载服务、脚本分组），但它的 `VERSION` 故意停在 `1.0.1`——改名之前它已经在开发库的账本里记过账，改掉会让那些 changeSet 按新身份重跑，而 `ALTER TABLE` 重复执行会直接失败。这一版发出去之后，下一个版本目录照常按新版本号写。
- 身份是三元组 `(author, id, filename)`：

| 步骤 | author | id | filename |
|---|---|---|---|
| changeSet | 文件里写的 | 文件里写的 | 版本号 |
| preups | `script` | `preups` | 版本号 |
| postups | `script` | `postups` | 版本号 |

changeSet 的 `id` 是 20 位定长数字：`yyyyMMddHHmmss`（14 位）+ 毫秒（3 位）+ 随机数（3 位），按时间递增。脚本没有作者属性，`author` 固定写 `script`，同一个动作换个人记账也不会重跑。

一个版本内部的顺序是固定的：`preups.ts` → `dbups.xml` 里的 changeSet（按文档顺序）→ `postups.ts`。三段都可以缺。

### 3.4 解析

使用 `@xmldom/xmldom`（W3C DOM 接口，零依赖；在 `package.json` 里是显式依赖，不依赖传递依赖）。
解析器接上 `onError` 并抛错：它的默认行为是记一条日志后继续，返回的可能是半个文档。

除「缺 `id` / `author` / `<sql>`」以外不做校验——这三样缺了就没法构成一条能记账的 changeset，其余语法与转义由写 changelog 的人负责。

### 3.5 账本

```sql
CREATE TABLE IF NOT EXISTS schema_migration (
  author         TEXT    NOT NULL,   -- 'powerinv' / 'script'
  id             TEXT    NOT NULL,   -- '20260924173105937842' / 'preups' / 'postups'
  filename       TEXT    NOT NULL,   -- 版本号，如 '1.0.0'
  title          TEXT    NOT NULL,
  exectype       TEXT    NOT NULL CHECK(exectype IN ('executed','failed')),
  order_executed INTEGER NOT NULL,
  applied_at     TEXT    NOT NULL,
  execution_ms   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (author, id, filename)
);
```

- 表由引擎用代码创建（`execSql(LEDGER_DDL)`），**不写进 changelog**：它不存在时，没有任何地方能记录「创建账本」这件事。
- 「跑过没有」**按身份判断**：表里有这个三元组就是跑过，没有就是没跑过；失败行（`failed`）不算跑过，下次启动还会重跑。
- 失败行在回滚**之后**另开事务写入：它活得起来，下次启动能看见上次是怎么炸的，但不会被误判为已执行。

### 3.6 执行流程

1. 建账本表（没有就建），**每次启动都清理旧备份**（见 3.10）；
2. 读账本、按身份算出待执行的动作序列；
3. 有待执行时，先推一条进度（当前步骤记为「正在备份数据库」）——备份要复制整个库，不能让它空着；备份写不出来就中止；
4. 逐步执行：`BEGIN` → 执行这一步（SQL 或脚本）→ 写账本 → `COMMIT`；抛错则 `ROLLBACK` → 另开事务记一行 `failed` → 中止整轮；
5. 每步之间让出一次事件循环（`await setImmediate`），让加载页有机会先画出来；同时检查主窗口是否已被关闭，已关闭就立即收手；
6. 进度 = 已完成的步骤数 / 总数，由主进程算好后推送。

**执行与记账在同一个事务里**，这是「脚本报错就当这一步没发生」的实现：脚本抛错时它写进数据库的行随事务一起回滚，`executed` 记录也不会写，账本里只留一行 `failed`。

`execSql()` 一次可执行多条语句，因此一条 changeset 就是一段文本，不做分号切分。

### 3.7 作为加载任务运行

升级是加载服务的一项「必须」任务（模块在 `src/main/loading/`，见 [loading.md](./loading.md)）：

```
createMain('/loading')
initLoadingIpc()       ① 加载服务的通道：状态快照、进度推送、退出、渲染进程任务下发
initDatabase()         ② 建数据目录、开库（没有就建文件）、注册 DB 通道
registerLoadTask(…)    ③ 登记「数据库升级」「初始化」「编辑器预热」
await startLoading()   ④ 按登记顺序跑必须的任务，最后公布终态
```

- 窗口排在开库与升级**之前**：窗口的显示、渲染进程的启动、升级的执行三者重叠。`initLoadingIpc()` 与 `initDatabase()` 都是同步的，排在第一个 `await` 之前——渲染进程发来的 invoke 要等主进程回到事件循环才会被派发，所以先建窗口再注册通道不存在竞态。
- `initUps(report)` 只做三件事：接上 `MigrationStore`、把引擎报的进度转成加载服务的 `report({ step, done, total, percent })`、失败时把备份路径写进附注再抛错。**升级自己的终态不转发**——切主界面还是停在错误页，由加载服务在所有「必须」任务之后统一公布。
- 主窗口被关掉时升级收手（`shouldAbort`），返回的 `aborted` 不算失败：应用本来就要退出了。
- **原先那条时序不变量已经消失**：升级与它之后的其余初始化都是任务表里的「必须」任务，终态排在两者之后才公布，所以「加载页收到终态时通道必然已经注册好」是登记表的结论，不再是需要人守的约定。
- 升级期间关掉窗口即退出应用：`before-quit` 会关库，正在执行的那一步随事务回滚。

### 3.8 什么会停下，什么不会

| | 情形 |
|---|---|
| **会停下**（加载页显示错误） | changelog 解析失败、缺少 `id` / `author` / `<sql>`、清单里版本号重复、SQL 执行报错、**升级脚本抛错**、备份写不出来 |
| **只提示**（`console.warn`，照常继续） | 账本里有当前代码不认识的身份（可能是降级到旧版本）、待执行的步骤排在已执行的之前（往已发布版本的中间插了东西） |

### 3.9 脚本的约束

- **一律异步 IO**：文件与其它 IO 走 `fs.promises`，不要 `readFileSync` 这类同步调用（`AGENTS.md` 的运行时约定同样适用于版本脚本）。引擎会 `await` 脚本的返回值。
- 不要自己开事务、不要自己写账本：引擎已经开了事务，也负责记账。
- 不要吞异常：抛出去才会回滚、才会出现在失败页。
- **文件操作不受事务保护**：回滚不会撤销已经写出去的文件，所以脚本要保证重复执行是安全的；需要覆盖或删除已有文件时，先自己留一份（放哪里、留几份由脚本决定，框架不清理脚本写的任何文件）。
- 可以 import 任何模块：它就是被编进主进程包的普通代码。
- 改了**已记账**的脚本内容不会生效（身份是版本号 + 生命周期）。需要重跑时手工删掉那一行：
  `DELETE FROM schema_migration WHERE author = 'script' AND filename = '1.0.1';`（1.0.1 就是这一版的 filename，见 3.3 的例外）

### 3.10 备份与清理

- 有待执行步骤时，升级前把整个库复制到 `data/backups/pre-migration-<yyyyMMdd-HHmmss>.db`；复制前先 `PRAGMA wal_checkpoint(TRUNCATE)`，否则复制出来的可能缺最近几次事务。
- **清理在引擎入口，每次启动都跑**，与本轮有没有升级无关：先确保备份目录存在，再删掉多余的旧备份（保留最近 `BACKUP_KEEP` = 3 份），删除的文件名写一条日志。只在「真的备份了」的时候清的话，不升级的库会一直堆着旧备份。
- 框架只清自己的 `pre-migration-*.db`。

### 3.11 与唯一写者的关系

迁移只在启动阶段执行，此时只有加载页窗口、其它进程也未启动，不存在并发写入。
这也是对后续任何新增进程的约束：它们必须在主进程完成升级之后才能打开数据库。

## 4. 风险

1. **迁移写错会破坏库** → 执行前强制备份、事务包裹、失败回滚。
2. **脚本改了文件却回滚** → 文件操作不在事务里，这是脚本自己的责任（见 3.9）；失败的那一步下次会重跑。
3. **大库建表或表重建耗时** → 在启动阶段执行，由升级页给出进度，不阻塞界面。
4. **XML 转义遗漏** → 漏写 `&` 是解析错误，漏写 `<` 可能被当成标签吞掉；解析器不校验这两条（见 3.1），由写 changelog 的人负责。
5. **复制版本目录忘了改 `VERSION`** → 清单里重复版本号直接抛错，启动就看得见。
6. **新增的启动步骤绕过任务表**（在 `startLoading()` 之后直接 `await` 做事）→ 渲染进程可能在通道注册前 invoke；应该登记成加载服务的一项任务，见 3.7 与 [loading.md](./loading.md)。
7. **解析器默认不抛错** → 必须接 `onError`，否则错误会变成静默的不完整 SQL。

## 5. 验证方法

1. **静态检查**：`tsc -p tsconfig.node.json`、`vue-tsc -p tsconfig.web.json`、`node scripts/check-docs.mjs`、以及「`database/` 里不出现 `@/ups`」这条依赖方向检查。
2. **迁移预演**：`node .agents/skills/db-maintenance/scripts/verify-migration.mjs` —— 全新库与现有库两条路径必须结构收敛。它**只重放 `dbups.xml`**，并会打印哪些版本带 preups/postups 而未被预演；带脚本的版本必须另外在库副本上冒烟。
3. **引擎验证**：引擎不依赖 electron，可以用内存库或临时库在纯 Node 下直接跑 `runUps()`：三段顺序、已记账的不再执行、脚本抛错时回滚且只记 `failed`、缺文件被跳过、重复版本号被拒绝、备份只保留 3 份。
4. **人工冒烟**（静态检查通过不等于功能正常）：在库副本上启动应用，确认加载页出现「1.0.1 预升级脚本」（步骤名是 `VERSION` + 说明，这一版显示的就是 1.0.1，见 3.3）；再次启动不再出现该步骤；人为让脚本抛错，确认加载页显示原因、数据未受影响。
5. **目录改名验证**：把某个版本目录改个名（`index.ts` 里的 `VERSION` 不动），确认账本里已执行的 changeset 仍被认作已执行。

## 6. 已知代价

| # | 事项 | 说明 |
|---|---|---|
| 1 | 手工改过结构的旧库不在修复范围 | 账本自本次机制建立，此后不会再出现这种局面 |
| 2 | 脚本按「版本号 + 生命周期」记账，改了已记账的脚本不会生效 | 与 changeset 同一条规矩；重跑要先删掉账本里那一行 |
| 3 | 升级脚本无法在纯 Node 的预演里跑 | 它们是编译进主进程包的 TS；带脚本的版本只能靠库副本上的手工冒烟 |
