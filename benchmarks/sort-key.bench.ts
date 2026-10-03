import { expect, test } from 'vitest';

import { CHARACTER_NAME_PROFILE, sortKeyOf } from '@/database/sort';

import { measure, report } from './harness';

/**
 * 造一批混合中文、英文与数字的名字，接近真实图库的目录名与文件名。
 * @param count 样本数
 * @returns 样本数组
 */
function buildSamples(count: number): string[] {
  const han = '测试图片角色场景人物风景动物植物建筑';
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const head = han[index % han.length];
    out.push(`${head}${head}目录 img${index % 997}.png`);
  }
  return out;
}

const SAMPLES = buildSamples(5000);

test('排序键：5000 个混合名（默认 profile）', () => {
  const result = measure('排序键 5000 个混合名', () => {
    for (const sample of SAMPLES) {
      sortKeyOf(sample);
    }
  }, { rounds: 3, runs: 1 });
  report(result);
  expect(result.perRunMs).toBeGreaterThan(0);
});

test('排序键：5000 个混合名（姓名 profile）', () => {
  const result = measure('排序键 5000 个混合名（姓名）', () => {
    for (const sample of SAMPLES) {
      sortKeyOf(sample, CHARACTER_NAME_PROFILE);
    }
  }, { rounds: 3, runs: 1 });
  report(result);
  expect(result.perRunMs).toBeGreaterThan(0);
});
