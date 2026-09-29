# 排序键

**状态**：现行架构
**最后更新**：2026-09-30

**关联**：[view-layouts.md](./view-layouts.md)（按这些键分片取数）、[ARCHITECTURE.md](../ARCHITECTURE.md)

---

## 1. 背景

1. **运行时 SQLite 只有码点序**：`PRAGMA compile_options` 里只有 `ENABLE_FTS3` / `ENABLE_FTS3_PARENTHESIS` / `ENABLE_FTS5`；试 `COLLATE pinyin` / `COLLATE zh` 都报 `no such collation sequence`（只有 `NOCASE` 可用），`node:sqlite` 也没有 `createCollation`。语言感知排序在数据库侧做不到。
2. **`localeCompare` 与分片冲突**：它要求先拿到全量再排，而图库 4175 行、图组 4181 行、图片文件 25066 行已经按页取数。
3. **纯码点不可接受**：今天的混排顺序是 `符号 → emoji → 数字 → 汉字(组内拼音) → 拉丁 → 其他文字`；纯码点会大小写分裂、汉字乱序、emoji 垫底。
4. **顺序必须能下推 SQL**：分页跳页、二级展开与查看器定位都靠 `ORDER BY`，排序键得是表里的普通列。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-30 | 首次定稿 | — |

---

## 2. 键的构成

键 = `<组前缀><正文>`：组前缀决定它整体排在哪一组，正文按「字符类」逐段转换后用单个空格连接。

| 前缀 | 归组（按**首字符**判定） | 正文规则 | 模块 |
|---|---|---|---|
| `1\|` | 标点 / 符号 / emoji | 原样小写 | `scripts/symbols.ts` |
| `2\|` | 数字开头 | 数字段零填充到 10 位 | `scripts/digits.ts` |
| `3\|` | 汉字开头 | 全拼、小写、无声调、字间空格分隔 | `scripts/han.ts` |
| `4\|` | 拉丁字母开头 | 原样小写 | `scripts/latin.ts` |
| `5\|` | 其他文字（希腊 / 西里尔 / 假名 / 谚文 / 未归类） | 原样小写 | `scripts/other.ts`（兜底） |
| `0\|` | 空名字（`''` 与全空白） | 无正文 | —— |

- **混合名逐段处理**：`第2章` → `3|di 0000000002 zhang`；`Alice 王` → `4|alice wang`。数字段零填充是相对码点序的有意行为（`img2` 排在 `img10` 之前）。
- **读不出读音的汉字**退回原字并用 `~` 打头，落在汉字组末尾——读不出就不猜，顺序稳定且可重算。
- **多音字由 profile 决定**：`sortKeyOf(text, profile)`。角色名用姓氏模式（`han: 'surname'`，`单田芳` 读 shan 而不是 dan），其余字段用常规读音。
- **全序**：所有按排序键分片的查询都写成 `ORDER BY <键列>, id`，同键的行才有稳定顺序（分页不重不漏的前提）。

## 3. 可插拔的排序模块

按**文字系统**分模块，一个字符归哪个模块由注册表按顺序问、第一个匹配者胜，兜底的 `other` 永远在最后。

`@
src/main/database/sort/
  key.ts        编排：把字符串切成「模块段」，查注册表，拼组前缀与正文
  registry.ts   注册表：按字符类分派
  profile.ts    字段 → profile：文本列 / 键列 / 读音策略（SORT_KEY_TABLES）
  scripts/      han / latin / digits / symbols / other
  index.ts      出口：sortKeyOf 与字段表
`@

每个模块实现同一份契约：`group`（组前缀）、`matches(char)`（这个字符归不归我管）、`encode(text, profile)`（把这一段变成可比较的正文）。

- **加一门文字只加一个文件**：日文（假名按五十音序）就是新增 `scripts/kana.ts` 并把注册表里的位置挪到 `other` 之前——调用方、数据列与重建流程都不动。
- **换拼音词库只动 `scripts/han.ts`**：它是唯一 import `pinyin-pro` 的文件。

## 4. 每个可排序字段一列，不建派生表

**决定**：`source.name`、`character.name`、`image_group.dir_name` / `dir_path`、`image_file.file_name`、`process_script.name`、`processed_image.script_name` 各自多一列 `<列名>_sort`，与原文同表同行。不建「一张派生表存所有键」。

**后果**：键跟着行生死，不存在孤儿键；加一个可排序字段要一次 changelog；派生列会出现在 `SELECT *` 的结果里，由 `shapeRow()` 统一剔除，业务对象看不到它们。

## 5. 列与索引

| 表 | 排序键列 | 索引 |
|---|---|---|
| `source` | `name_sort`、`root_path_sort` | `(name_sort, id)` |
| `character` | `name_sort` | `(name_sort, id)` |
| `image_group` | `dir_name_sort`、`dir_path_sort` | `(dir_name_sort, id)` |
| `image_file` | `file_name_sort` | `(file_name_sort, id)` |
| `process_script` | `name_sort` | `(name_sort, id)` |
| `processed_image` | `script_name_sort`（脚本名的副本） | `(script_name_sort, id)` |

- 另有一条 `processed_image(selected_file)`：图库按**文件名**排序时，SQLite 要能从 `image_file(file_name_sort, id)` 方向驱动再探测 `processed_image`，否则会退化成排序或全表扫描。
- 键由写入点在写这一行的同时一起写（同一张表的 INSERT / UPDATE 里）。图库行的脚本名不再用子查询取，由调用方传入 name + 键。

## 6. 键的生命周期

- **键是派生数据**：规范一变就是一次整表重建，任何时候都能重算，不需要额外备份，也不该手工改库里的值。
- **升级时整表回填**：1.1.1 的升级给存量行算一遍键；回填按表扫一遍算完该表所有列，收尾核对没有空键，非 0 就中止整轮升级。
- **重建入口**：`scripts/rebuild-sort-keys.mjs`——编译 `sort/` 的实现对库重算、只写变化的行、收尾对账。
- **老库升级路径上的约束**：1.1.0 的 postups 会调用 `insertScript` / `renameScript`，那时键列还没建出来。这两个写入点把键写成单独一条 `UPDATE`，缺列时跳过并记一条日志，由 1.1.1 的回填补上。

## 7. 改动时的检查点

- 改 `sort/` 里的规则（分组顺序、逐段规则、读音）→ **必须整表重建**，否则库里新旧规则混杂。
- 新增可排序字段 → `SORT_KEY_TABLES` 加一行 + 一次 changelog（加列与索引）+ 写入点自己传键。
- 写入点若会在「键列建出来之前」的老库升级路径上被调用 → 先跳过、留给回填，不要直接写键。
- 加文字 → 新增 `scripts/<语言>.ts` 并调整注册表顺序；换词库只动 `han.ts`。
- 不要绕过 `sortKeyOf` 手工拼键；不要手工 UPDATE 库里的键。

## 8. 已知取舍

| 取舍 | 代价 |
|---|---|
| 每字段一列而不是一张派生表 | 加字段要一次 changelog；派生列要靠 `shapeRow()` 挡在业务对象之外 |
| 用拼音库而不是数据库的排序规则 | 二次元 / 生僻 / 多音字可能读出不合直觉的顺序，只有角色名用得上姓氏模式；音准不保证 |
| 键在写入时算 | 写入路径多一步；改名与换规则之后必须重建，忘了就新旧混杂 |
| 数字段零填充到 10 位 | 超过 10 位的数字段退化成前缀序；相对码点序是有意的行为变化 |
