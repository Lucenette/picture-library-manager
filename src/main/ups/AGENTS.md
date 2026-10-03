# AGENTS.md — src/main/ups/

升级模块的本地规则。启动阶段的登记与调度（谁阻塞、谁预热、跑在哪个进程）是加载服务的事，见 [docs/design/loading.md](../../docs/design/loading.md)。

- 升级独立成 `src/main/ups/`，`src/main/database/` 是它的下层：升级模块调用数据库模块跑 SQL、读写账本，
  **`database/` 里不出现 `@/ups`**。
- 一个版本 = `src/main/ups/changesets/<package.json 的版本号>/` 一个目录，最多三件东西：
  `preups.ts`（SQL 之前跑）、`dbups.xml`（`<changeSet>`）、`postups.ts`（SQL 之后跑），缺哪个就跳过哪个。
  目录里的 `index.ts` 写死 `VERSION` 并导出 `changelog`——**版本号以代码里的常量为准，目录名只给人看**；
  外层 `changesets/index.ts` 只 import 各版本目录的 `index.ts`。清单里出现相同版本号直接抛错。
- 建表语句不进代码，写进 `dbups.xml` 的 `<changeSet>` 里，一条用 `<comment>` 说明它做了什么。
- **账本按身份记账、执行过的不再执行**：changeSet 是 `(author, id, filename)`（`id` 用 20 位定长数字时间戳），
  脚本是 `(script, 'preups' | 'postups', 版本号)`。**已发布版本的目录冻结**：改一条已执行的 changeset 或脚本
  都不会生效，要重跑得先删掉 `schema_migration` 里那一行。账本表由引擎用代码创建，不要写进 changelog。
- 升级脚本是普通模块（可以 import 任何东西），但：一律异步 IO；不要自己写 `BEGIN` / `COMMIT`；
  不要吞异常（抛错才回滚，脚本写进库的东西随事务一起不留）；**文件操作不受事务保护**，
  要改或删已有文件就自己先备份，并保证重复执行是安全的。
- **破坏性结构变更（删列、删表、改名）之前，先在 preups 里把要保留的数据落成文件并自校验**：列一旦丢掉，
  除了升级前的库备份之外没有第二份副本，而备份是整库回滚、不能只捞回一个字段。落盘放在 SQL 之前、校验放在同一段脚本末尾，
  任一步失败就中止整轮升级——那时列还在。
- 转义由写的人负责：`<sql>` 里出现 `<` 写成 `&lt;`（漏写可能被 XML 当成标签吞掉），`&` 写成 `&amp;`。
- 需要图片解码的补数据仍归任务系统，不要塞进 changeSet。
