import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { SORT_KEY_TABLES } from '@/database/sort';

const CHANGESETS = join(process.cwd(), 'src/main/ups/changesets');

/** 把所有版本目录的 dbups.xml 拼起来 */
function allChangeLogXml(): string {
  const parts: string[] = [];
  for (const entry of readdirSync(CHANGESETS, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const file = join(CHANGESETS, entry.name, 'dbups.xml');
    if (existsSync(file)) {
      parts.push(readFileSync(file, 'utf8'));
    }
  }
  return parts.join('\n');
}

test('每个排序键列都能在 changelog 里找到（键列与结构变更不脱节）', () => {
  const xml = allChangeLogXml();
  for (const table of SORT_KEY_TABLES) {
    for (const field of table.fields) {
      expect(xml, table.table + '.' + field.sortColumn).toContain(field.sortColumn);
    }
  }
});
