import { performance } from 'node:perf_hooks';

/** 一次计时结果 */
export interface BenchResult {
  name: string;
  runs: number;
  bestMs: number;
  perRunMs: number;
}

/**
 * 热身一次后计多轮，取最快的一轮——比平均更抗机器抖动。
 * @param name 名称（写清规模）
 * @param fn 被测函数
 * @param options rounds 计时轮数、runs 每轮调用次数
 * @returns 计时结果
 */
export function measure(name: string, fn: () => void, options: { rounds?: number; runs?: number } = {}): BenchResult {
  const rounds = options.rounds ?? 5;
  const runs = options.runs ?? 5;
  fn();
  let bestMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) {
      fn();
    }
    bestMs = Math.min(bestMs, performance.now() - started);
  }
  return { name, runs, bestMs, perRunMs: bestMs / runs };
}

/**
 * 与 measure 相同，但被测函数是异步的。
 * @param name 名称（写清规模）
 * @param fn 被测的异步函数
 * @param options rounds 计时轮数、runs 每轮调用次数
 * @returns 计时结果
 */
export async function measureAsync(
  name: string,
  fn: () => Promise<void>,
  options: { rounds?: number; runs?: number } = {},
): Promise<BenchResult> {
  const rounds = options.rounds ?? 5;
  const runs = options.runs ?? 3;
  await fn();
  let bestMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) {
      await fn();
    }
    bestMs = Math.min(bestMs, performance.now() - started);
  }
  return { name, runs, bestMs, perRunMs: bestMs / runs };
}

/**
 * 把结果打成一行；基准用例的产物就是这行数字。
 * @param result 计时结果
 */
export function report(result: BenchResult): void {
  console.log(`${result.name}: ${result.perRunMs.toFixed(3)} ms/次（最快一轮 ${result.bestMs.toFixed(1)} ms / ${result.runs} 次）`);
}
