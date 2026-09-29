import {
  countRowsMissingSortKeys, listSortKeyRows, updateSortKeyRow,
} from '@/database/db';
import { SORT_KEY_TABLES, sortKeyOf } from '@/database/sort';
import type { ChangeScriptContext } from '@/ups/engine';

/**
 * 升级收尾：给存量行补上排序键。
 *
 * 一张表只扫一遍：`listSortKeyRows` 收下整张表的原文，算完所有列再逐行写回；
 * 逐列扫表会把同一张表读 N 遍。整段跑在升级事务里，抛错随事务回滚，重跑安全。
 *
 * 收尾自校验按表问一句「还有没有空键」：回填的列名与 `SORT_KEY_TABLES` 对不上时，
 * 这里会拦下来，而不是留一堆空键让排序静默错乱。
 *
 * 签名按升级脚本的契约收下上下文，但**用不到它**（见 1.1.0 preups 的同名说明）。
 */
export function run(_ctx: ChangeScriptContext): void {
  for (const table of SORT_KEY_TABLES) {
    for (const row of listSortKeyRows(table)) {
      updateSortKeyRow(table, row.id, table.fields.map((field, index) => sortKeyOf(row.texts[index], field.profile)));
    }
    const missing = countRowsMissingSortKeys(table);
    if (missing > 0) {
      throw new Error(`backfill left ${missing} row(s) without sort key in ${table.table}`);
    }
  }
}
