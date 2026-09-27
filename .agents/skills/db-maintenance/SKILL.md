---
name: db-maintenance
description: 在本仓库改动数据库结构、订正库内数据或写版本升级脚本时使用——新增表与列、改名表/列/索引、把持久化 JSON 的键名跟着改、往版本目录里写 dbups.xml 与 preups/postups、在库副本上预演迁移、排查迁移失败或启动时的 SQL 报错。
---

# 数据库维护

## Summary

库结构与数据的演进只有一条路径：往 `src/main/ups/changesets/<版本号>/` 里写。一个版本目录最多三件东西——
`preups.ts`（SQL 之前跑）、`dbups.xml`（changeSet 的 SQL）、`postups.ts`（SQL 之后跑），缺哪个就跳过哪个——
由应用启动时的升级模块按顺序执行并记账本。
这份 skill 说明一次改动从判断类型到验证通过的完整做法，以及唯一容易漏的那一类——**代码改了名，而库里已持久化的数据还叫旧名字**。
设计缘由见 [docs/design/ups.md](../../../docs/design/ups.md)，常驻硬约束见 [AGENTS.md](../../../AGENTS.md) 的「升级模块与版本目录」。

## Table of Contents

- [标准流程](#标准流程)
- [版本目录与三段时机](#版本目录与三段时机)
- [迁移文件的写法](#迁移文件的写法)
- [写升级脚本](#写升级脚本)
- [数据目录在用户主目录](#数据目录在用户主目录)
- [改名与改键名](#改名与改键名)
- [在库副本上预演](#在库副本上预演)
- [迁移失败或启动报错](#迁移失败或启动报错)
- [交稿前的自检](#交稿前的自检)

## 标准流程

1. 判断改动属于哪一类：**结构**（表 / 列 / 索引）、**数据订正**（改已有行的内容）、**文件操作**（要动数据目录里的东西，只有脚本能干），或它们的组合。
2. 决定写进哪个版本目录：往**当前未发布版本**（`package.json` 的版本号）的目录里追加。该版本发布后目录冻结，新的变更写进新版本号的目录。
3. 结构写 `<changeSet>`（见下节），需要在 SQL 前后动文件或做计算就写脚本（见「写升级脚本」）。一条 changeSet / 一段脚本管一件能独立说清的事。
4. 如果涉及**重命名**，执行「改名与改键名」那一节的排查——三类债不能只改代码。
5. 在库副本上预演（见下节）：全新库与现有库两条路径必须收敛到同一结果。
6. 交稿前自检。升级真正执行在应用启动时，沙箱里通常跑不了 Electron，所以要在回复里写清哪些是"已验证"、哪些要使用者启动冒烟。

## 版本目录与三段时机

```
src/main/ups/changesets/
  index.ts              版本清单：只 import 各版本目录的 index.ts
  1.0.0/  index.ts + dbups.xml
  1.0.1/  index.ts + preups.ts + dbups.xml + postups.ts     ← 四件都可缺
```

**新增一个版本目录**（复制上一个目录是最容易出错的路径）：

1. 目录名用版本号，与 `package.json` 对应；
2. `index.ts` 里把 `VERSION` 改成新版本号（**目录名只是给人看的，版本号以这个常量为准**）；
3. 把不需要的 `dbups.xml` / `preups.ts` / `postups.ts` 删掉，别留下上一个版本的内容；
4. 在 `changesets/index.ts` 的 `CHANGELOG_VERSIONS` 末尾追加一行。

两处身份容易记混，记住这张表就够：

| 步骤 | 账本 author | 账本 id | 账本 filename |
|---|---|---|---|
| changeSet | 文件里写的 | 文件里写的 | 版本号（取自 `VERSION`） |
| preups | `script` | `preups` | 版本号 |
| postups | `script` | `postups` | 版本号 |

清单里出现两个相同 `version` 会直接抛错——复制目录忘了改 `VERSION` 时就是这样被拦住的。

## 迁移文件的写法

```xml
<changeSet id="20260926075901713568" author="powerinv">
  <comment>task | 任务表：订正持久化 payload 里的旧键名</comment>
  <sql>
    UPDATE task SET payload = replace(payload, '"galleryId"', '"sourceId"') WHERE payload LIKE '%"galleryId"%';
  </sql>
</changeSet>
```

- **id** 是 20 位定长数字、按时间递增：`yyyyMMddHHmmss` + 毫秒(3) + 随机(3)。
- **comment** 写这条 changeset 干了什么，格式 `<表名> | <中文名表>`。它会写进账本，也会显示在启动加载页上。
- **一条 changeset 管一张表**；索引写在它所属表的那一条里。
- **转义自己负责**：`<sql>` 里 `<` 写成 `&lt;`、`&` 写成 `&amp;`。解析器不校验，漏写可能被 XML 当成标签吞掉。
- **身份是 `(author, id, filename)`**：追加新的会被执行；**改一条已经执行过的不会生效**——账本按身份跳过它，而且没有任何校验会告诉你。
- **账本表 `schema_migration` 由升级引擎用代码创建**，不要写进 changelog：账本不存在时，没有任何地方能记录「创建账本」这件事。

## 写升级脚本

`preups.ts` / `postups.ts` 导出 `run`，拿到的上下文只有 `dataDir`，其余靠 import：

```ts
import { runInMigrationTransaction } from '@/database/db';   // 需要时也可以直接用 db 的能力

export async function run(ctx: ChangeScriptContext): Promise<void> {
  // 引擎已经开好事务，这里直接干活
}
```

- 脚本是**编译进主进程包的普通模块**，可以 import 任何东西（`database` 是 `ups` 的下层，不成环）。
- **一律异步 IO**（`fs.promises`），同步调用会卡住主进程。
- 不要自己写 `BEGIN` / `COMMIT`，也不要写账本：引擎已经开好事务并负责记账。
- **不要吞异常**：抛出去才会回滚、才会显示在失败页。
- **文件操作不受事务保护**：脚本抛错时它写进数据库的行随事务回滚，但已经写出去的文件不会消失；要覆盖或删除已有文件就先自己备份，并保证重复执行是安全的。
- 改了**已记账**的脚本内容不会生效（身份是版本号 + 生命周期）。要重跑先删掉那一行：
  `DELETE FROM schema_migration WHERE author = 'script' AND filename = '1.0.1';`

## 数据目录在用户主目录

唯一指定的用户数据目录是打包后的 `~/.plmanager/data/`（Windows 为 `C:\Users\<你>\.plmanager\data`，开发态是 `dist/data/`）：
库、备份、脚本以及将来的日志都在里面。**不要把它挪回安装目录**——Windows 的覆盖安装会先静默调用旧版卸载器、
清空整个安装目录，库放那儿等于每次更新都可能丢；Linux 的 deb 装在 root 所有的 `/opt/PLManager`、
macOS 的 exe 在 `.app` 内部，也都不是能写库的地方。

内置默认脚本的源码在 `src/static/default-script.js`，构建时由 `?raw` 内联进主进程；把它插进库这件事是
`1.0.1` 的 `preups.ts` 干的，不再挂在启动流程里每次查一遍。数据目录只有 `getDataDir()` 一个来源。

## 改名与改键名

改一个字段名会留下三类债，其中只有第一类会被编译器抓到：

| 类别 | 例子 | 怎么找 |
|---|---|---|
| 代码 | 类型、参数、SQL 常量与语句、CSS 类、组件文件名、路由名 | `git grep -i <旧名>`，注意大小写与复数（`GALLERY`、`Galleries` 都不会被 `[Gg]allery` 匹配到） |
| 数据库结构 | 表名、列名、索引名 | 追加 `ALTER TABLE ... RENAME TO` 与 `RENAME COLUMN`；SQLite 没有 `ALTER INDEX`，索引改名要 `DROP` 再 `CREATE` |
| **库里的持久化数据** | `task.payload` / `task.result` 里的 JSON 键名 | **`tsc` 与 `vue-tsc` 完全看不到**：用 `LIKE` 或 `json_extract` 把所有会写 JSON 的列扫一遍 |

第三类是 2026-09 那次启动崩溃的成因：代码读 `sourceId`，而 `task.payload` 里还存着 `{"galleryId":9}`，取出 `undefined` 绑到 SQL 参数上，
启动阶段直接抛 `Provided value cannot be bound to SQLite parameter 1`。**它不在类型里，只在数据里。**

先在库副本上找出来：

```sql
SELECT id, type, status FROM task WHERE payload LIKE '%"galleryId"%' OR result LIKE '%"galleryId"%';
```

再把订正写进 changeset，用 `replace()`：

```sql
UPDATE task SET payload = replace(payload, '"galleryId"', '"sourceId"') WHERE payload LIKE '%"galleryId"%';
```

另外：**显示用的字符串不该能把启动打死**。像"取来源名拼任务标题"这种地方，取不到就退回占位文案，不要去执行参数为 `undefined` 的语句。

## 在库副本上预演

```bash
node .agents/skills/db-maintenance/scripts/verify-migration.mjs
```

它跑两条路径，都不碰真实库：

1. **全新库**：把各版本 `dbups.xml` 里的 `<sql>` 按顺序跑在临时库上，打印最终的表 / 列 / 索引——这是"新装一台机器"的结果。
2. **现有库**：在工作区内复制 `dist/data/picture-lib.db`，只跑账本里没记过的 changeset，打印前后的行数——这是"老库升上来"的结果。

它还会打印每个版本目录里有哪些文件，并单独列出**没有被预演的 `preups.ts` / `postups.ts`**：脚本是编译进主进程包的 TS，
纯 Node 跑不了，带脚本的版本必须额外在库副本上手工冒烟。

脚本在 [scripts/verify-migration.mjs](scripts/verify-migration.mjs)：与 `references/`、`templates/` 一样，按用途放在 skill 的子目录里。

两条路径必须收敛到同一个结构。比对是**按集合**的：**列顺序不算差异**——老库上后来用 `ALTER TABLE ADD COLUMN` 补的列会排在最后，
而全新库在建表语句里就已就位，属历史遗留、无害。
如果集合本身都不一致，说明用了"改写 CREATE"而不是"追加 ALTER"：已执行过的 CREATE 不会被重跑，老库会停在旧结构上。

## 迁移失败或启动报错

- 只要有待执行的步骤，升级会先把整个库复制到 `dist/data/backups/pre-migration-<yyyyMMdd-HHmmss>.db`，**每次启动清理旧备份、保留最近 3 份**。恢复就是把它拷回 `dist/data/picture-lib.db`（先关掉应用）。
- 账本里 `exectype = 'failed'` 的那一行记着上次失败的原因；启动加载页也会显示错误与备份路径。**失败不算执行过，下次启动会重跑那一步。**
- 脚本报错时数据库里只留下那一行 `failed`：它写进库的其它内容随事务回滚了；已经写出去的文件不会回滚。
- `no such table: xxx` 通常是"代码预期新结构、库还是旧结构"：升级没跑（身份已在账本里）或跑失败了。
- `Provided value cannot be bound to SQLite parameter N` 是**绑定到了 `undefined`**：顺着那条语句的参数往上找哪个字段取空了，多半是持久化数据的键名问题。
- 不要清空 `dist/`：开发库就在 `dist/data/picture-lib.db`，删掉没有报错、也找不回来。

## 交稿前的自检

- [ ] `<sql>` 转义正确，XML 能被 `@xmldom/xmldom` 解析，`changeSet` 数量与预期一致
- [ ] 只往当前未发布版本追加；没有改动任何已执行过的 changeset 或脚本
- [ ] `index.ts` 里的 `VERSION` 与版本号一致，清单里没有重复版本号
- [ ] 涉及改名时三类债都排查过：代码 / 结构 / 库里的 JSON
- [ ] 改的是数据目录本身的话，`getDataDir()` 与文档里的路径一起改了
- [ ] `verify-migration.mjs` 的新库与现有库两条路径都通过；带脚本的版本另外在库副本上冒烟过
- [ ] `tsc -p tsconfig.node.json` 与 `vue-tsc -p tsconfig.web.json` 通过
- [ ] 回复里说清哪些已验证、哪些需要使用者启动应用冒烟
