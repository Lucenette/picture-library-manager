# 升级模块 ups：版本目录与升级脚本

**状态**：进行中
**关联**：[script-management.md](./script-management.md)——那边的「接管旧脚本」要挂在这里的 preups 上

---

## 1. 背景

1. **「一次升级」现在只有一种载体：`changesets/<版本号>.xml` 里的 `<sql>`。** SQL 写不出文件、也读不到应用里的常量，所以「先把旧数据落成文件再删列」这类步骤无处安放——而这正是脚本管理改造的前置：本机开发库里 3 条脚本有 2 条的原文件早已不存在，源码只剩 `code` 列，删列之前必须把它写出去。
2. **只能靠 SQL 时，「插入默认数据」只能放在应用代码里每次启动检查一遍。** 现在的 `seedBuiltinScript()` 每次启动都要查一次库，没有「这一版该做的事只做一次」的表达方式，而它本来就是一次性的数据订正。
3. **升级已经不只是数据库的事了**（要写数据目录里的文件、要跑一段代码、要按顺序编排多个步骤），却整个塞在 `database/` 里：`db.ts` 既开库、又管 CRUD、又管 IPC 调度、又发起升级，`changeset.ts` 与 `changeset-ipc.ts` 也挂在数据库目录下，看目录看不出谁在上、谁在下。
4. **升级脚本是与 SQL 同级的一次改动，需要被同样记账。** 账本里没有这个身份就执行、有就跳过——脚本和 SQL 共用一套「执行过的不再执行」的保证，而不是靠脚本自己判断。
5. **升级的时机夹在初始化中间。** `bootstrap()` 是「开库 → 注册全部 IPC → 升级 → 其它」，升级脚本执行时既要假定库已就绪，又要在「其它都还没开始」的干净状态下动数据目录里的文件。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-27 | 首次定稿 | — |
| 2026-09-27 | 脚本身份定为「版本号 + 生命周期」，去掉内容指纹；每个版本目录自带 `index.ts` | 评审意见：目录改名不该动账本身份；幂等与 SQL 同为写者责任 |
| 2026-09-27 | 文件名与生命周期改为 `preups` / `postups`；启动顺序改成「开库 → 升级 → 其它初始化」；不再限制脚本改文件（改为由脚本自己备份）；备份清理改成每次启动都跑 | 评审意见 |
| 2026-09-27 | 升级独立成 `ups` 模块、`database` 是它的下层；`dbups.xml`；脚本调用加异常处理（抛错则整个事务回滚）；脚本要求异步；初始化收敛成 `initDatabase()` + `initUps()` | 评审意见 |

---

## 2. 目标与非目标

**目标**

1. 升级是一个独立模块 `ups`，`database` 在它下层：升级模块调用数据库模块来执行迁移 SQL 与写账本，数据库模块不反过来依赖升级模块。
2. 一个版本 = 一个目录，目录里最多三个约定文件：`preups.ts`、`dbups.xml`、`postups.ts`，缺哪个就跳过哪个。
3. 执行顺序固定：preups → `dbups.xml` 里的 changeSet（按文档顺序）→ postups。
4. 三段的每一步都进同一个账本：**执行过的身份不再执行**；失败即回滚该步并中止整轮升级，下次启动从下一条接着来。
5. 身份只由代码里的常量决定，不依赖目录名——目录改名不影响「这条跑过没有」。
6. 脚本报错时，它写进数据库的东西一条都不留。
7. 启动顺序是「开库（没有就建）→ 升级 → 其它初始化」，升级脚本执行时库一定已经就绪。
8. 升级前备份数据库，并且**每次启动都清理旧备份**，不让备份目录无限长大。

**非目标**

- 不做 down migration（仍靠备份恢复）；不引入真正的 Liquibase 或声明式标签（`<createTable>`、`<addColumn>` 之类），`<sql>` 仍是唯一载体；不做步骤之间的依赖编排（就是三段顺序执行）；框架不替脚本备份文件（见 3.6）；不在升级脚本里做图片解码——那仍归任务系统。

## 3. 设计

### 3.1 模块与目录

升级独立成 `src/main/ups/`，`src/main/database/` 降到它下层：

```
src/main/ups/                  升级模块（上层）
  index.ts                     initUps()：注册升级页通道 + 执行本轮升级
  engine.ts                    引擎：解析 changelog、计划、执行、备份与清理
  progress.ts                  升级页的 IPC 与进度推送
  changesets/                  版本目录
    1.0.0/
      index.ts                 这一版的描述：版本号 + 三段内容
      dbups.xml
    1.0.1/
      index.ts
      preups.ts
      dbups.xml
      postups.ts               ← 按需，可以没有
    index.ts                   只 import 各版本目录的 index.ts

src/main/database/             数据库模块（下层）
  db.ts                        建数据目录、开库（没有就建文件）、CRUD、DB 的 IPC 调度
  sql.ts                       运行时 SQL 常量（含账本读写语句）
```

- 目录名对代码没有意义，只给人看：版本号一律取自目录内 `index.ts` 里的常量，所以**目录改名不会改变账本身份**。
- `git mv 1.0.0.xml 1.0.0/dbups.xml`；账本里的 `filename` 仍然是 `1.0.0`，既有账本行不受影响。
- 版本目录里除这三个约定文件外，可以放被它们 import 的私有模块，那些模块不参与调度。
- 三个文件都可缺：只有 `preups.ts` 的版本目录是合法的。

### 3.2 清单与类型

每个版本目录的 `index.ts` 自报家门，把版本号写死：

```ts
// ups/changesets/1.0.1/index.ts
import type { ChangeLogVersion } from '@/ups/engine';
import { run as preups } from './preups';
import dbups from './dbups.xml?raw';

/** 版本号写死在这里：目录改名不影响账本身份 */
export const VERSION = '1.0.1';

export const changelog: ChangeLogVersion = { version: VERSION, dbups, preups };
```

外面的 `ups/changesets/index.ts` **只 import 各版本的 `index.ts`**，不碰 `dbups.xml` 与脚本：

```ts
import type { ChangeLogVersion } from '@/ups/engine';
import { changelog as v100 } from './1.0.0';
import { changelog as v101 } from './1.0.1';

/** 顺序即执行顺序，必须与版本号递增一致 */
export const CHANGELOG_VERSIONS: readonly ChangeLogVersion[] = [v100, v101];
```

- `ChangeLogVersion = { version: string; dbups?: string; preups?: ChangeScript; postups?: ChangeScript }`，`ChangeScript = (ctx: ChangeScriptContext) => void | Promise<void>`。
- 脚本是普通模块导出，由 electron-vite 编进主进程包——运行时不读磁盘、不需要 TS 运行时，import 什么都可以（见 3.8）。
- 「文件没有就不执行」在这里表现为「`index.ts` 里不写这一项」：构建期静态 import 一个不存在的文件会直接构建失败，正好堵住「以为会跑其实没跑」。
- `ChangeLogFile` 更名 `ChangeLogVersion`、`CHANGELOG_FILES` 更名 `CHANGELOG_VERSIONS`。
- **清单里出现两个相同 `version` 时直接抛错**：复制版本目录忘了改 `VERSION` 会让新版本的 changeSet 顶用旧版本的身份，从而被账本判定为已执行而静默跳过——宁可启动就失败。

### 3.3 执行顺序与事务

`planChangesets()` 把清单展平成一条**动作序列**，每一步要么是 SQL、要么是脚本：

```
1.0.0  dbups:   <changeSet> …
1.0.1  preups:  脚本
1.0.1  dbups:   <changeSet> …
1.0.1  postups: 脚本
```

- 每一步单独一个事务：`BEGIN` → 执行 → 写账本 → `COMMIT`；失败则 `ROLLBACK` → 记一行 `failed` → 中止整轮。与今天「之前成功的保留、下次从这一条接着来」一致。
- 步骤之间照旧让出一次事件循环，并检查主窗口是否已被关闭。
- 备份仍是一轮升级开始时做一次（有待执行步骤时）；没有待执行步骤时只做清理，不备份。

### 3.4 账本身份

复用现有账本表、不改结构（它是 `CREATE TABLE IF NOT EXISTS`，改结构对老库不生效）：

| 步骤 | author | id | filename |
|---|---|---|---|
| changeSet | 文件里写的 | 文件里写的 | 版本号 |
| preups | `script` | `preups` | 版本号 |
| postups | `script` | `postups` | 版本号 |

也就是「版本号 + 生命周期」。`title` 写「预升级脚本」「升级后脚本」，加载页因此显示成 `1 / 3　1.0.1 预升级脚本`。`exectype`、`order_executed`、`applied_at`、`execution_ms` 全部沿用。

**「执行过的不再执行」由引擎保证**，和 changeSet 完全同一条路径：账本里有这个三元组就跳过，失败行（`failed`）不算执行过、下次还会跑。

### 3.5 异常处理：脚本报错就当这一步没发生

引擎把每一步（SQL 或脚本）都包在 `try/catch` 里，并且**执行与记账在同一个事务内**：

```
try {
  runInMigrationTransaction(async () => {   // BEGIN
    await step();                            // 脚本抛错 → 整个事务回滚
    writeMigrationLedger({ exectype: 'executed' });
  });                                        // COMMIT
} catch (error) {
  writeMigrationLedger({ exectype: 'failed' });   // 回滚之后另开事务写一行，供排查
  throw new Error(`<版本> / <生命周期> 执行失败：<原因>`);
}
```

- **脚本抛错 → 它写进数据库的东西一条都不留**（同一个事务，整体回滚），`executed` 记录也不会写。
- 账本里只留一行 `failed`：它活得下来，下次启动能看见上次是怎么炸的，但**不会被当成已执行**——所以失败的那一步下次会重跑。
- 中止整轮升级，加载页显示原因；其它失败（迁移 SQL 报错、备份写不出来）走同一条路径。
- 脚本自己**不要吞异常**：抛出去才会回滚、才会出现在失败页（仓库本来就禁止静默降级）。

### 3.6 幂等与文件操作：写脚本的人负责

引擎保证「记账过的不再跑」和「报错就回滚」，但**保证不了「已经写出去的文件」**——文件操作不在事务里。

- 脚本可以做任何文件操作（这正是引入升级脚本的目的），但**事务回滚不会撤销已经写出去的文件**。所以脚本要自己保证重复执行是安全的：需要覆盖或删除已有文件时，**在动手之前自己留一份**（放哪里、留几份由脚本决定；框架不清理脚本写的任何文件，它只清自己的 `pre-migration-*.db`）。
- 开发期改了已记账的脚本内容不会生效（身份就是版本号 + 生命周期），这与「改一条执行过的 changeSet 不生效」是同一条规矩。需要重跑时手工删掉那一行：

```sql
DELETE FROM schema_migration WHERE author = 'script' AND filename = '1.0.1';
```

这条逃生口要写进 `.agents/skills/db-maintenance/SKILL.md`。

- **已发布版本的目录冻结**这条规则对脚本同样成立，而且更要守——脚本不会被任何指纹机制救回来。

### 3.7 分层、初始化与启动顺序

升级模块调用数据库模块，数据库模块不知道升级模块的存在。数据库模块为此暴露的就这么多：

| 数据库模块对外（供 ups 用） | 作用 |
|---|---|
| `getDataDir()` / `getDbPath()` | 数据目录与库文件路径（备份、`ctx.dataDir` 要用） |
| `execSql(sql)` | 在同一个连接上执行一段 SQL（可多条）：迁移 SQL、账本建表、`PRAGMA wal_checkpoint` |
| `runInMigrationTransaction(fn)` | 把一段回调包进 `BEGIN` / `COMMIT`，抛错则 `ROLLBACK` 并原样抛出（回调可以是 async） |
| `readMigrationLedger()` / `writeMigrationLedger(entry)` | 账本 |

初始化收敛成两次：

```
createMain('/loading')
initDatabase()        ① 建数据目录、开库（没有就建文件）、注册 DB 通道
await initUps()       ② 注册升级页通道 + 执行本轮升级（preups → dbups → postups）
initTaskIpc() initDialogs() initScriptIpc() …   ③ 其它初始化
taskManager.init(mainWindow); warmPopup()       ④
```

- `initUps()` 是升级模块唯一的对外入口：注册 `UPS_*` 通道与执行升级都归它，不再有单独的 `initChangesetIpc()`。`initDatabase()` 同理吞掉了原来的 `initDbIpc()`——数据库相关的初始化只有这一个函数。
- `initUps()` 返回 `MigrationOutcome`，启动流程据此决定失败后等用户点「退出」再 `app.quit()`。
- **不变量：升级终态之后到所有通道注册完成之间不许有 `await`。** 引擎跑完会推一条 `succeeded`，渲染进程收到就 `router.replace('/')` 回主界面；主进程是在第一次让出事件循环之后才会派发它发来的 `invoke`，所以只要 ③④ 全是同步调用，就不可能出现「通道还没注册就开始 invoke」。这条要写进 `AGENTS.md`，以后往 ③④ 里加 `await` 就是破坏它。

数据库模块不再依赖 `ups/`（清单改由 `ups/index.ts` 引入），所以升级脚本 import `@/database/db` 也不会成环：

```
main/index.ts ──► database/db.ts
              └► ups/index.ts ──► ups/engine.ts ──► database/db.ts
                              └► ups/changesets ──► <版本>/index.ts ──► preups.ts ──► database/db.ts
```

### 3.8 脚本能做什么

脚本拿到 `ChangeScriptContext = { dataDir: string }`，并且它是一个普通模块：**可以 import 任何模块**，包括数据库 CRUD 与纯常量模块。

约束四条：

- **一律用异步操作**：文件与其它 IO 走 `fs.promises`，不要 `readFileSync` 这类同步调用——引擎在主进程里跑脚本，同步 IO 会把窗口拖动、新建窗口一起卡住（`AGENTS.md` 的运行时约定）。引擎会 `await` 脚本的返回值。
- 引擎已经开好事务：脚本里不要再写 `BEGIN` / `COMMIT`，也不要自己写账本。
- 不要做长耗时工作——引擎只在步骤之间检查窗口是否被关闭。
- 不要吞异常；需要改/删已有文件时自己先备份（3.6）。

第一个使用者是 `1.0.1/preups.ts`：把 `bootstrap()` 里每次启动都调的「插入内置默认脚本」搬成一次性的版本动作。**这段定义写在版本目录里**——内置脚本叫什么、源码从哪来、已经存在时不动它，都是这一版的事实；数据库那边只提供「按路径查」（`getScriptByPath`）与「写进去」（`upsertScript`）两个能力，不再认识「内置默认脚本」这个概念。脚本管理改造的「接管旧脚本」也挂在这里，它要用的文件写入放 `@/script/files.ts`（纯文件模块，不构成环）。

### 3.9 备份与清理

- 有待执行步骤时，升级前把整个库复制到 `data/backups/pre-migration-<yyyyMMdd-HHmmss>.db`（先 `PRAGMA wal_checkpoint(TRUNCATE)`，否则可能丢掉最近的 WAL）。
- **清理挪到引擎入口，每次启动都跑**，与本轮有没有升级无关：先 `mkdir` 备份目录，再删掉多余的老备份，删除的文件名写一条日志。现在只在「真的备份了」的时候才清，不升级就一直堆着。
- 保留份数 `BACKUP_KEEP` 由 5 降到 **3**：开发库实测 103 MB，5 份就是 500 MB 以上。这个常量想再调随时改。
- 框架只清自己的 `pre-migration-*.db`；脚本自己写的备份不在清理范围内。

### 3.10 进度与失败

加载页不用改：`MigrationProgress` 的字段一个没变，只是 `total` 里多了脚本步骤、`currentTitle` 可能是「1.0.1 预升级脚本」。通道名跟着模块改名：`CHANGESET_STATE` / `CHANGESET_PROGRESS` / `CHANGESET_QUIT` → `UPS_STATE` / `UPS_PROGRESS` / `UPS_QUIT`（值 `ups:state` / `ups:progress` / `ups:quit`）。脚本抛错会被包成 `1.0.1 / script:preups（预升级脚本）执行失败：<原因>`，失败页照旧显示错误与备份路径。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/main/ups/`（`index.ts` / `engine.ts` / `progress.ts`） | 升级模块；引擎与进度 IPC 从 `database/` 搬来 |
| `src/main/database/changeset.ts` → `src/main/ups/engine.ts`、`changeset-ipc.ts` → `ups/progress.ts` | `git mv` + 内容改造 |
| `src/main/database/changesets/` → `src/main/ups/changesets/` | `git mv`；`1.0.0.xml` → `1.0.0/dbups.xml` 并补 `1.0.0/index.ts`；**新增** `1.0.1/`（`index.ts` + `preups.ts` + `dbups.xml`）；外层 `index.ts` 只 import 各版本的 `index.ts` |
| `src/main/ups/engine.ts` | 类型（`ChangeLogVersion` / `ChangeScript` / 动作序列）、`planChangesets()` 展平三段、每步的 try/catch + 事务、脚本账本身份、重复版本号检测、入口清理旧备份、`BACKUP_KEEP` 5 → 3 |
| `src/main/ups/index.ts` | `initUps()`：注册通道 + 执行升级（吞掉原 `initChangesetIpc()`） |
| `src/main/database/db.ts` | 对外暴露 3.7 那 5 个函数 + `getScriptByPath` / `upsertScript`；不再 import `ups/`；`initDatabase()` 吞掉原 `initDbIpc()`；删掉 `seedBuiltinScript()`（它的职责搬进 1.0.1 的 preups） |
| `src/main/database/sql.ts` | 账本读写语句；建表 DDL 仍由代码执行（不写进 changelog） |
| `src/main/index.ts` | 启动顺序按 3.7 重排；`initUps()` 取代 `runMigrations()` 与 `initChangesetIpc()` |
| `src/common/ipcChannels.ts` + `src/renderer/views/startup/LoadingPage.vue` | `CHANGESET_*` → `UPS_*` |
| `scripts/check-docs.mjs` | XML 编码检查改成递归找 `ups/changesets/**/dbups.xml` |
| `.agents/skills/db-maintenance/scripts/verify-migration.mjs` | 按版本目录取 `dbups.xml`；打印哪些版本有 preups/postups 而未被预演 |
| `.agents/skills/db-maintenance/SKILL.md` | 目录布局（`ups/`）、三段时机、异常与幂等、删账本行的逃生口、新增版本目录的步骤、自检清单 |
| `docs/design/db-migration.md` | **落地后 `git mv` 成 `docs/design/ups.md`**（同一个子系统，不新开第二份设计文档），并按本文档修订目录、顺序、异常与幂等、启动页、备份清理与保留份数 |
| `docs/ARCHITECTURE.md` | 分层表（`ups/` 在 `database/` 之上）、数据流一节里的 `changesets/<版本号>.xml` → `ups/changesets/<版本号>/dbups.xml` |
| `docs/README.md` | 编码检查覆盖的范围改成新的 XML 路径 |
| `AGENTS.md` | §8 改成 `ups` 模块与版本目录的硬约束；补「升级终态之后不许 await」这条不变量 |
| `docs/roadmap/view-layouts.md` | 里面写死的 `database/`（`changesets/`）路径跟着改 |
| `CHANGELOG.md` | 未发布条目 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 复制版本目录忘了改 `VERSION` | 清单重复版本号即抛错，启动就看得见，不会静默跳过 |
| 脚本改/删了文件却事务回滚，留下半成品 | 框架不替脚本收拾（这正是脚本的用途）；幂等与自备份是写脚本的人的责任，文档与 skill 写明；失败的那一步下次会重跑 |
| 升级终态之后新增了 async 初始化 | 渲染进程可能在通道注册前 invoke；把「终态之后到初始化结束之间不许 await」写成 AGENTS 里的硬约束，评审时盯着这条 |
| 升级脚本写同步 IO，卡住主进程 | 约定一律异步；`AGENTS.md` 的运行时约定同样适用于版本脚本 |
| 备份目录无限长大 | 清理挪到引擎入口、每次启动都跑；保留份数降到 3；删除写日志 |
| 老库的账本 `filename` 与新目录不一致 | 版本号取自代码常量、与目录名无关；账本 `filename` 不变，迁移只挪目录位置 |
| 已发布版本的脚本被改动 | 身份是版本号 + 生命周期，改了也不会重跑——库里与线上行为不一致却没人知道；靠「已发布目录冻结」约束，文档写重 |
| 数据库模块不小心又依赖 ups | 依赖方向在评审时盯：`database/` 里不许出现 `@/ups` 的 import |
| TS 脚本无法在纯 Node 的迁移预演里跑 | 预演脚本只重放 `dbups.xml`，并明确打印哪些版本有脚本未被执行；有脚本的版本必须额外在库副本上冒烟 |

## 6. 验证方法

1. 静态检查：`tsc -p tsconfig.node.json`、`vue-tsc -p tsconfig.web.json`、`node scripts/check-docs.mjs`。
2. 依赖方向检查：`grep -r "@/ups" src/main/database` 必须为空。
3. 迁移预演：`node .agents/skills/db-maintenance/scripts/verify-migration.mjs` —— 全新库与现有库两条路径结构收敛；输出里能看出每个版本有哪些文件、哪些脚本没被预演。
4. 引擎验证（引擎不依赖 electron，纯 Node 可跑）：用临时库验证三段顺序、已记账的脚本不再执行、**脚本抛错时它写进库的行一条不留且账本只记 `failed`**、缺文件被跳过、清单里重复版本号被拒绝、备份目录里只保留最近 3 份。
5. 目录改名验证：把 `1.0.0` 目录改个名（`index.ts` 里的 `VERSION` 不动），确认账本里已执行的 changeset 仍被认作已执行。
6. 人工冒烟（交给使用者）：在库副本上启动应用，确认升级页出现「1.0.1 预升级脚本」；内置默认脚本只入库一次（再次启动不再出现这一步）；故意让 preups 抛错，确认失败页显示原因、数据未受影响；正常启动时主界面不会报「没有注册处理程序」。
7. 明确未验证：真实旧库上的完整升级路径。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 备份保留份数 `BACKUP_KEEP` | 3（开发库单份 103 MB）；嫌小随时调 |
| 2 | `dbups.xml` 缺失的版本是否合法 | 合法：三个文件都可缺，只有 `preups.ts` 的版本目录也认 |
| 3 | 复制目录忘改 `VERSION` 怎么防 | 清单里重复版本号直接抛错；skill 里的「新增版本」步骤再写一遍 |
