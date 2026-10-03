import { expect, test } from 'vitest';

import { CHARACTER_NAME_PROFILE, sortKeyOf } from '@/database/sort';

import { measure, report } from './harness';

/** 样本规模：5000 个名字。开发库实测 2.5 万条记录，取同数量级的一次全量排序。 */
const SAMPLE_COUNT = 5000;
/** 汉字池：16 个常用字，覆盖不同拼音分组，默认与姓名两种 profile 都要过一遍。 */
const HAN_POOL = '测试图片角色场景人物风景动物植物建筑';
/** 文件名数字的上界：997 是质数，与汉字池长度 16 互质，样本不会退化成简单周期。 */
const FILE_INDEX_MODULUS = 997;

/**
 * 按命名常量造样本：汉字池循环取字，文件号按质数取模。
 * @param count 样本数
 * @returns 样本数组
 */
function buildSamples(count: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const head = HAN_POOL[index % HAN_POOL.length];
    out.push(`${head}${head}目录 img${index % FILE_INDEX_MODULUS}.png`);
  }
  return out;
}

const SAMPLES = buildSamples(SAMPLE_COUNT);

test(`排序键：${SAMPLE_COUNT} 个混合名（默认 profile）`, () => {
  const result = measure(`排序键 ${SAMPLE_COUNT} 个混合名`, () => {
    for (const sample of SAMPLES) {
      sortKeyOf(sample);
    }
  });
  report(result);
  expect(result.medianMs).toBeGreaterThan(0);
});

test(`排序键：${SAMPLE_COUNT} 个混合名（姓名 profile）`, () => {
  const result = measure(`排序键 ${SAMPLE_COUNT} 个混合名（姓名）`, () => {
    for (const sample of SAMPLES) {
      sortKeyOf(sample, CHARACTER_NAME_PROFILE);
    }
  });
  report(result);
  expect(result.medianMs).toBeGreaterThan(0);
});
