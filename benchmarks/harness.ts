import { performance } from 'node:perf_hooks';

/** 一次基准的结果：以每轮样本的中位数为主，最快/最慢一并保留，用来看抖动。 */
export interface BenchResult {
  name: string;
  samples: number;
  runsPerSample: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
}

/** 计时选项 */
export interface BenchOptions {
  samples?: number;
  runsPerSample?: number;
}

/**
 * 把每轮样本耗时折算成单次调用，取中位数。
 * @param name 名称（写清规模）
 * @param runsPerSample 每轮调用次数
 * @param perRun 每轮折算出的单次调用耗时
 * @returns 计时结果
 */
function summarize(name: string, runsPerSample: number, perRun: number[]): BenchResult {
  const sorted = [...perRun].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    name,
    samples: sorted.length,
    runsPerSample,
    medianMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * 同步基准：热身一次，再取 samples 轮、每轮重复 runsPerSample 次。
 *
 * 取中位数而不是最快轮：最快轮只反映「机器最好的一瞬间」，中位数才代表常态。
 * @param name 名称（写清规模）
 * @param fn 被测函数
 * @param options samples 轮数、runsPerSample 每轮次数
 * @returns 计时结果
 */
export function measure(name: string, fn: () => void, options: BenchOptions = {}): BenchResult {
  const samples = options.samples ?? 7;
  const runsPerSample = options.runsPerSample ?? 1;
  fn();
  const perRun: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const started = performance.now();
    for (let run = 0; run < runsPerSample; run += 1) {
      fn();
    }
    perRun.push((performance.now() - started) / runsPerSample);
  }
  return summarize(name, runsPerSample, perRun);
}

/**
 * 与 measure 相同，但被测函数是异步的。
 * @param name 名称（写清规模）
 * @param fn 被测的异步函数
 * @param options samples 轮数、runsPerSample 每轮次数
 * @returns 计时结果
 */
export async function measureAsync(
  name: string,
  fn: () => Promise<void>,
  options: BenchOptions = {},
): Promise<BenchResult> {
  const samples = options.samples ?? 7;
  const runsPerSample = options.runsPerSample ?? 1;
  await fn();
  const perRun: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const started = performance.now();
    for (let run = 0; run < runsPerSample; run += 1) {
      await fn();
    }
    perRun.push((performance.now() - started) / runsPerSample);
  }
  return summarize(name, runsPerSample, perRun);
}

/**
 * 把结果打成一行：中位数为主，最快/最慢用来判断抖动。
 * @param result 计时结果
 */
export function report(result: BenchResult): void {
  console.log(
    `${result.name}: 中位数 ${result.medianMs.toFixed(3)} ms/次` +
      `（最快 ${result.minMs.toFixed(3)} / 最慢 ${result.maxMs.toFixed(3)}，` +
      `${result.samples} 轮 × ${result.runsPerSample} 次）`,
  );
}
