import { expect, test } from 'vitest';

import { buildSimilarGroups, type SimilarInputRow } from '@/image/similar';

import { measureAsync, report } from './harness';

/**
 * 造 n 行：哈希由 500 个种子循环生成，因此天然带大量相同组与相似组。
 * @param count 行数
 * @returns 输入行
 */
function buildRows(count: number): SimilarInputRow[] {
  const rows: SimilarInputRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const hash = new Uint8Array(8);
    const seed = index % 500;
    for (let bit = 0; bit < 24; bit += 1) {
      if (((seed >> (bit % 8)) & 1) === 1) {
        hash[bit >> 3] |= 1 << (bit % 8);
      }
    }
    rows.push({
      filePath: `/lib/img${index}.png`,
      fileName: `img${index}.png`,
      thumbnail: null,
      width: 10,
      height: 10,
      phash: hash,
    });
  }
  return rows;
}

const ROWS = buildRows(1000);

test('相似分组：1000 张图', async () => {
  const result = await measureAsync('相似分组 1000 张图', async () => {
    await buildSimilarGroups(ROWS);
  }, { rounds: 3, runs: 1 });
  report(result);
  expect(result.perRunMs).toBeGreaterThan(0);
});
