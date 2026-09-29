# 排序键（派生列 + 可插拔的排序模块）

**状态**：已实施（提交 `caf741f`、`96e4bb7`、`16099bf`、`55865db`）
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md)、[view-layouts.md](./view-layouts.md)（谁在按这些键排序）

---

## 1. 背景

1. **运行时 SQLite 只有码点序**：`PRAGMA compile_options` 里只有 `ENABLE_FTS3` / `ENABLE_FTS3_PARENTHESIS` / `ENABLE_FTS5`，试 `COLLATE pinyin` / `COLLATE zh` 都报 `no such collation sequence`（只有 `NOCASE` 可用），`node:sqlite` 也没有 `createCollation`。语言感知排序在数据库侧做不到。
2. **JS 的 `localeCompare` 与分片冲突**：它要求先拿到全量再排，而图库 4175 行、图组 4181 行已经改成按页取数。
3. **纯码点不可接受**：应用内今天的混排顺序是 `符号 → emoji → 数字 → 汉字(组内拼音) → 拉丁 → 其他文字`；纯码点会大小写分裂、汉字乱序、emoji 垫底。

## 2. 设计

### 2.1 一条键 = 组前缀 + 正文

键的组前缀用可读 ASCII，正文按「字符类」逐段转换后用单个空格连接。

| 前缀 | 归组（按**首字符**判定） | 正文规则 | 模块 |
|---|---|---|---|
| `1\|` | 标点 / 符号 / emoji | 原样小写 | `scripts/symbols.ts` |
| `2\|` | 数字开头 | 数字段零填充到 10 位（自然序：`img2` < `img10`） | `scripts/digits.ts` |
| `3\|` | 汉字开头 | 全拼、小写、无声调、字间空格分隔（`张三` → `3\|zhang san`） | `scripts/han.ts` |
| `4\|` | 拉丁字母开头 | 原样小写 | `scripts/latin.ts` |
| `5\|` | 其他文字（希腊 / 西里尔 / 假名 / 谚文 / 未归类） | 原样小写 | `scripts/other.ts`（兜底） |
| `0\|` | 空名字（`''` 与全空白） | 无正文 | —— |

- **逐段处理混合名**：汉字段转拼音、数字段零填充、其余段小写原样：`第2章` → `3|di 0000000002 zhang`；`Alice 王` → `4|alice wang`。
- **读不出读音的汉字**退回原字并用 `~` 打头，落在汉字组末尾（读不出就不猜，顺序稳定、可重算）。
- **多音字由 profile 决定**：`sortKeyOf(text, profile)`——`character.name` 用 `han: 'surname'`（人名姓氏模式），其余字段用 `han: 'default'`。
- **tie-break**：`ORDER BY <列>, id`（全序，分片必需）。

### 2.2 可插拔：按文字系统分模块

`@
src/main/database/sort/
  key.ts        编排：把字符串切成「模块段」，查注册表，拼组前缀与正文
  registry.ts   文字系统 → 模块 的注册表：按字符类分派，第一个匹配者胜
  profile.ts    字段 → profile：文本列 / 键列 / 读音策略（SORT_KEY_TABLES，回填与重建按它遍历）
  scripts/
    han.ts      汉字 → pinyin-pro（surname / default 两档；唯一 import pinyin-pro 的文件）
    latin.ts    拉丁 → 小写原样
    digits.ts   数字 → 零填充
    symbols.ts  标点 / emoji → 原样
    other.ts    兜底：未归类的文字 → 原样
  index.ts      出口：sortKeyOf / 字段表
`@

每个模块的契约：

`@ts
interface SortScript {
  /** 组前缀，决定它整体排在哪一组（1| … 5|） */
  group: string;
  /** 这个字符归不归我管；注册表按顺序问，第一个 true 的胜出 */
  matches(char: string): boolean;
  /** 把这一段变成可比较的正文（例：汉字 → 拼音，数字 → 零填充） */
  encode(text: string, profile: SortProfile): string;
}
`@

- **加一门文字只加一个文件**：例如日文（假名按五十音序）就新增 `scripts/kana.ts` 并插到注册表里 `other.ts` 之前——调用方、数据列、重建流程都不动。
- **换拼音词库**只动 `scripts/han.ts`。

### 2.3 每字段一列，不建派生表

1. **一致性**：键列跟着行生死，删实体不会留下孤儿键；派生表要「写业务行 + 写键行」两处，删实体还得手动清（本仓库没有外键），漏一处就是静默错序。
2. **改动局部**：可排序字段的写入点全在 `src/main/database/db.ts` 里，grep 得到、评审得过来。
3. **查询简单**：`ORDER BY c.name_sort, c.id` 直接吃 `(name_sort, id)` 索引，不需要多一次 join。
4. **派生表的强项用不上**：「以后频繁加可排序字段」才值得多引入一个概念与一类同步 bug；可排序字段是有限且稳定的 8 个。
5. **代价与对策**：加字段要一次 changelog；`SELECT *` 会把派生列带进业务对象——在 `shapeRow()` 里统一剔除 `*_sort`（一处，集中），不改那 14 条 `SELECT *`。

### 2.4 列与索引清单（8 列 / 6 表）

| 表 | 新列 | 排序索引 | 写入点 |
|---|---|---|---|
| `source` | `name_sort`、`root_path_sort` | `(name_sort, id)` | `INSERT_SOURCE` / `addSource` |
| `character` | `name_sort` | `(name_sort, id)` | `INSERT_CHARACTER` / `insertCharacter`、`RENAME_CHARACTER` / `renameCharacter` |
| `image_group` | `dir_name_sort`、`dir_path_sort` | `(dir_name_sort, id)` | `INSERT_IMAGE_GROUP` / `insertImageGroup` |
| `image_file` | `file_name_sort` | `(file_name_sort, id)` | `INSERT_IMAGE_FILE` / `insertImageFiles` |
| `process_script` | `name_sort` | `(name_sort, id)` | `INSERT_SCRIPT` / `insertScript`、`RENAME_SCRIPT` / `renameScript` |
| `processed_image` | `script_name_sort`（脚本名的副本） | `(script_name_sort, id)` | `INSERT_PROCESSED` / `UPDATE_PROCESSED` / `upsertProcessedImage`、`RENAME_PROCESSED_SCRIPT_NAME` |

- 额外一条索引 `processed_image(selected_file)`：图库按**文件名**排序时，SQLite 要能从 `image_file(file_name_sort, id)` 方向驱动再探测 `processed_image`，否则会退化成排序或全表扫描。
- `INSERT_PROCESSED` / `UPDATE_PROCESSED` 里的脚本名不再用子查询，由 JS 传入 name + key（子查询给不出排序键）。

## 3. 升级与回填

- 版本目录 `src/main/ups/changesets/1.1.1/`：4 个 changeSet（8 个 `ALTER TABLE ADD COLUMN` + 7 条索引）+ `postups.ts` 回填。
- **回填一张表只扫一遍**、算完该表所有列再写回；收尾按表校验「还有没有空键」，非 0 就抛错顶回整轮升级。整段跑在升级事务里，失败随事务回滚，幂等。
- 实测（`dist/data/picture-lib.db` 的副本）：DDL 230ms、33907 行回填 4441ms；用真引擎把副本退回 1.1.1 之前再跑一遍：5 步全过、0 条错误日志、7.4 秒（含整库备份）。
- **老库升级途中会遇到「列还没建出来」**：1.1.0 的 postups 会调用 `insertScript` / `renameScript`，那时事务里还没有 `name_sort`。这两个写入点因此把键单独写成一条 `UPDATE`，缺列时跳过并记一条日志，由 1.1.1 的回填补上。
- 事务进行中不做整库备份（`PRAGMA wal_checkpoint` 在事务里必定失败，逐行触发会把日志刷爆）。

## 4. 整表重建

`@
node scripts/rebuild-sort-keys.mjs [库文件]      # 默认 dist/data/picture-lib.db
`@

- 现场用 TypeScript 编译器 API 编译 `sort/`（产物落在 `dist/sort-rebuild-*` 再删掉：系统临时目录里解析不到 `pinyin-pro`）。
- 逐表重算，**只写真的变了的行**，收尾核对没有空键；库还没跑 1.1.1 升级时提示先启动一次应用，并以退出码 1 结束。
- 验收实测：首次 33907 行全改（约 2.5s）、再跑 0 改动、故意改坏一行后只改回那一行。

## 5. 不变量与风险

- **键是派生数据**：规范一变就整表重建，任何时候都能重算，不需要额外备份；规则以 `sort/` 为准，不要手工改库里的键。
- **行是唯一真相**：不存在孤儿键。
- **读音不保证正确**：二次元 / 生僻 / 多音字可能读出不合直觉的顺序；退化表现只是顺序不理想，不会崩、不会丢数据。
- **新增可排序字段**：`SORT_KEY_TABLES` 加一行（文本列 / 键列 / profile）+ 一次 changelog + 给新列建索引；写入点按自己的 SQL 传参。
- **加字段要挑版本**：老库升级路径上会调用到的写入点（如脚本行）必须先确认列已在同一轮或更早的 changeSet 里建好，否则要像 `insertScript` 那样先跳过。

## 6. 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-30 | 首次定稿：规则、可插拔模块、列与索引、升级回填与重建入口 | 从 [view-layouts.md](./view-layouts.md) 的 §9 拆出来——它属于数据库模块，不是「平铺视图」的一部分 |
