import { test, expect } from 'vitest';

import {
  buildSimilarGroups,
  SAME_DISTANCE,
  SIMILAR_DISTANCE,
  type SimilarInputRow,
} from '@/image/similar';

/** 造一个 8 字节哈希，把给定的位号置 1；位号差就是汉明距离 */
function hash(bits: number[]): Uint8Array {
  const out = new Uint8Array(8);
  for (const bit of bits) {
    out[Math.floor(bit / 8)] |= 1 << (bit % 8);
  }
  return out;
}

function row(name: string, phash: Uint8Array | null): SimilarInputRow {
  return { filePath: '/lib/' + name, fileName: name, thumbnail: null, width: 10, height: 10, phash };
}

test('阈值常量与设计一致', () => {
  expect(SAME_DISTANCE).toBe(3);
  expect(SIMILAR_DISTANCE).toBe(10);
});

test('完全相同的两张进 same 组', async () => {
  const data = await buildSimilarGroups([row('a', hash([0, 1, 2])), row('b', hash([0, 1, 2]))]);
  expect(data.same).toHaveLength(1);
  expect(data.same[0].members).toHaveLength(2);
  expect(data.compared).toBe(2);
  expect(data.skipped).toBe(0);
});

test('没有相同对时 similar 为空（第二层只连相同组）', async () => {
  const data = await buildSimilarGroups([row('a', hash([])), row('b', hash([0, 1, 2, 3]))]);
  expect(data.same).toHaveLength(0);
  expect(data.similar).toHaveLength(0);
});

test('两组各自的相同对之间会被连成 similar', async () => {
  const data = await buildSimilarGroups([
    row('a1', hash([0, 1, 2, 3, 4, 5, 6, 7])),
    row('a2', hash([0, 1, 2, 3, 4, 5, 6, 7])),
    row('b1', hash([0, 1, 2])),
    row('b2', hash([0, 1, 2])),
  ]);
  expect(data.same).toHaveLength(2);
  expect(data.similar).toHaveLength(1);
  expect(data.similar[0].members).toHaveLength(4);
});

test('没有哈希的图计入 skipped', async () => {
  const data = await buildSimilarGroups([row('a', hash([0])), row('b', null)]);
  expect(data.compared).toBe(1);
  expect(data.skipped).toBe(1);
});

test('空输入不炸', async () => {
  const data = await buildSimilarGroups([]);
  expect(data.same).toEqual([]);
  expect(data.similar).toEqual([]);
  expect(data.compared).toBe(0);
});
