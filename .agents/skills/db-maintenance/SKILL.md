---
name: db-maintenance
description: 在本仓库改动数据库结构或订正库内数据时使用——新增表与列、改名表/列/索引、把持久化 JSON 的键名跟着改、写 changeset、在库副本上预演迁移、排查迁移失败或启动时的 SQL 报错。
---

# 数据库维护

## Summary

库结构的演进只有一条路径：往 `src/main/database/changesets/<版本号>.xml` 末尾追加 `<changeSet>`，由应用启动时的迁移执行并记账本。
这份 skill 说明一次改动从判断类型到验证通过的完整做法，以及唯一容易漏的那一类——**代码改了名，而库里已持久化的数据还叫旧名字**。
设计缘由见 [docs/design/db-migration.md](../../../docs/design/db-migration.md)，常驻硬约束见 [AGENTS.md](../../../AGENTS.md) 的「数据库结构由 changelog 演进」。

## Table of Contents

- [标准流程](#标准流程)
- [迁移文件的写法](#迁移文件的写法)
- [数据目录在用户主目录](#数据目录在用户主目录)
- [改名与改键名](#改名与改键名)
- [在库副本上预演](#在库副本上预演)
- [迁移失败或启动报错](#迁移失败或启动报错)
- [交稿前的自检](#交稿前的自检)

## 标准流程

1. 判断改动属于哪一类：**结构**（表 / 列 / 索引）、**数据订正**（改已有行的内容），或两者都有。都写进 changeset，不要手改自己的库。
2. 决定写进哪个文件：往**当前未发布版本**的文件末尾追加。该版本发布后文件冻结，新的结构变更写进新版本号的文件。
3. 写 `<changeSet>`（见下节）。一条一件能独立说清的事。
4. 如果涉及**重命名**，执行「改名与改键名」那一节的排查——三类债不能只改代码。
5. 在库副本上预演（见下节）：全新库与现有库两条路径必须收敛到同一结果。
6. 交稿前自检。迁移真正执行在应用启动时，沙箱里通常跑不了 Electron，所以要在回复里写清哪些是"已验证"、哪些要使用者启动冒烟。

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
- **账本表 `schema_migration` 由 `changeset.ts` 用代码创建**，不要写进 changelog：账本不存在时，没有任何地方能记录「创建账本」这件事。

## 数据目录在用户主目录

唯一指定的用户数据目录是打包后的 `~/.plmanager/data/`（Windows 为 `C:\Users\<你>\.plmanager\data`，开发态是 `dist/data/`）：
库、备份、示例脚本以及将来的日志都在里面。**不要把它挪回安装目录**——Windows 的覆盖安装会先静默调用旧版卸载器、
清空整个安装目录，库放那儿等于每次更新都可能丢；Linux 的 deb 装在 root 所有的 `/opt/PLManager`、
macOS 的 exe 在 `.app` 内部，也都不是能写库的地方。

打包时 `electron-builder.yml` 的 `extraFiles` 会把仓库的 `data/` 复制到安装目录，那只是给人参考的示例脚本，
**不是数据目录**。数据目录只有 `getDataDir()` 一个来源。

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

1. **全新库**：把 changelog 里所有 `<sql>` 按顺序跑在临时库上，打印最终的表 / 列 / 索引——这是"新装一台机器"的结果。
2. **现有库**：在工作区内复制 `dist/data/picture-lib.db`，只跑账本里没记过的 changeset，打印前后的行数——这是"老库升上来"的结果。

脚本在 [scripts/verify-migration.mjs](scripts/verify-migration.mjs)：与 `references/`、`templates/` 一样，按用途放在 skill 的子目录里。

两条路径必须收敛到同一个结构。比对是**按集合**的：**列顺序不算差异**——老库上后来用 `ALTER TABLE ADD COLUMN` 补的列会排在最后，
而全新库在建表语句里就已就位，属历史遗留、无害。
如果集合本身都不一致，说明用了"改写 CREATE"而不是"追加 ALTER"：已执行过的 CREATE 不会被重跑，老库会停在旧结构上。

## 迁移失败或启动报错

- 只要有待执行的 changeset，迁移会先把整个库复制到 `dist/data/backups/pre-migration-<yyyyMMdd-HHmmss>.db`，保留最近 5 份。**恢复就是把它拷回 `dist/data/picture-lib.db`**（先关掉应用）。
- 账本里 `exectype = 'failed'` 的那一行记着上次失败的原因；启动加载页也会显示错误与备份路径。
- `no such table: xxx` 通常是"代码预期新结构、库还是旧结构"：迁移没跑（身份已在账本里）或跑失败了。
- `Provided value cannot be bound to SQLite parameter N` 是**绑定到了 `undefined`**：顺着那条语句的参数往上找哪个字段取空了，多半是持久化数据的键名问题。
- 不要清空 `dist/`：开发库就在 `dist/data/picture-lib.db`，删掉没有报错、也找不回来。

## 交稿前的自检

- [ ] `<sql>` 转义正确，XML 能被 `@xmldom/xmldom` 解析，`changeSet` 数量与预期一致
- [ ] 只追加在文件末尾；没有改动任何已执行过的 changeset
- [ ] 涉及改名时三类债都排查过：代码 / 结构 / 库里的 JSON
- [ ] 改的是数据目录本身的话，`getDataDir()` 与文档里的路径一起改了
- [ ] `verify-migration.mjs` 的新库与现有库两条路径都通过
- [ ] `tsc -p tsconfig.node.json` 与 `vue-tsc -p tsconfig.web.json` 通过
- [ ] 回复里说清哪些已验证、哪些需要使用者启动应用冒烟
