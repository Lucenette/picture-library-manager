import { expect, test } from 'vitest';

import { buildSimilarGroups, type SimilarInputRow } from '@/image/similar';

import { measureAsync, report } from './harness';

/** 样本规模：1000 张图。识别会把一次图库两两比对，1000 张约 50 万次比对。 */
const ROW_COUNT = 1000;
/** 哈希种子上界：500 种模式，制造大量小簇而不是一个巨簇。 */
const SEED_MODULUS = 500;
/** 每个哈希置 1 的位数：8 字节里取 24 位，让汉明距离落在相同/相似阈值附近。 */
const HASH_BITS = 24;

/**
 * 按命名常量造输入行：哈希由 500 个种子循环生成，天然带大量相同组与相似组。
 * @param count 行数
 * @returns 输入行
 */
function buildRows(count: number): SimilarInputRow[] {
  const rows: SimilarInputRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const hash = new Uint8Array(8);
    const seed = index % SEED_MODULUS;
    for (let bit = 0; bit < HASH_BITS; bit += 1) {
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

const ROWS = buildRows(ROW_COUNT);

test(`相似分组：${ROW_COUNT} 张图`, async () => {
  const result = await measureAsync(`相似分组 ${ROW_COUNT} 张图`, async () => {
    await buildSimilarGroups(ROWS);
  }, { samples: 7, runsPerSample: 3 });
  report(result);
  expect(result.medianMs).toBeGreaterThan(0);
});
