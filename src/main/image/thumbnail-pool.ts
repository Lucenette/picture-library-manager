import { cpus } from 'os';
import type { Worker } from 'worker_threads';
import createThumbnailWorker from '@/image/thumbnail-worker?nodeWorker';
import type { ThumbnailEngineName } from '@common/types';
import type { ThumbnailOutcome, ThumbnailRequest, ThumbnailResponse } from '@/image/thumbnail-decode';

/** 线程数上限：留出核心给主进程与渲染进程 */
const MAX_WORKERS = 4;

/**
 * 单个线程的 V8 堆上限。
 *
 * 注意它只管 V8 堆，解码产生的 RGBA 缓冲区是堆外内存不受此限制；
 * 真正约束峰值内存的是扫描器对大文件「单独串行」的调度。
 */
const WORKER_MEMORY_LIMIT_MB = 1024;

/**
 * 单张图片的处理超时。
 *
 * 解码器遇到畸形文件可能永不返回；没有超时的话整个任务会一直挂在这一步。
 * 放得比较宽是因为超大图解码本身就要几十秒，这里只兜底"永不返回"。
 */
const REQUEST_TIMEOUT_MS = 120_000;

/** 连续补位失败多少次后判定线程池不可用 */
const MAX_REPLACEMENTS = 8;

/**
 * 处理过这么大的图片之后就把线程换掉。
 *
 * 解码大幅图片会在工作线程里留下大量内存碎片，且不会及时归还给系统；
 * 换掉线程是唯一能确定释放的方式。放在这里而不是交给 GC，是因为
 * 实测解完一张 1.3 亿像素的图，进程 RSS 会停在 GB 级。
 */
const RETIRE_AFTER_BYTES = 256 * 1024 * 1024;

/** 池中的一个线程；alive 变为 false 后不再派发任何任务 */
interface PoolWorker {
  worker: Worker;
  alive: boolean;
}

/** 等待空闲线程的请求 */
interface Waiter {
  resolve: (slot: PoolWorker) => void;
  reject: (error: Error) => void;
}

/**
 * 缩略图线程池。
 *
 * 两条硬性保证：
 *
 * 1. **死线程绝不回收**——给已退出的线程 postMessage 不会有任何回复，
 *    一旦把它放回空闲队列，等它的请求就永久挂起（曾导致扫描任务卡死）。
 * 2. **每个请求都有超时**——单张图卡住只让它自己没有缩略图，不会拖住整个任务。
 */
export class ThumbnailPool {
  private readonly slots: PoolWorker[] = [];
  private readonly idle: PoolWorker[] = [];
  private readonly waiters: Waiter[] = [];
  private nextId = 0;
  private closed = false;

  /** 线程池已不可用时的原因；置位后所有请求立即失败，而不是挂起 */
  private broken: Error | null = null;
  private replacementCount = 0;

  /** 最近一次成功使用的解码引擎，供任务结果展示 */
  private lastEngine: ThumbnailEngineName | 'none' = 'none';

  constructor(size: number = resolvePoolSize()) {
    for (let index = 0; index < size; index += 1) {
      this.spawn();
    }
  }

  get concurrency(): number {
    return this.slots.length;
  }

  /** 本次运行实际用到的解码引擎 */
  get engine(): ThumbnailEngineName | 'none' {
    return this.lastEngine;
  }

  /**
   * 生成一张缩略图。
   *
   * @param estimatedBytes 这张图解码预计要占的内存，用于决定是否值得换掉线程
   */
  async analyze(filePath: string, estimatedBytes: number): Promise<ThumbnailOutcome> {
    const slot = await this.acquire();
    try {
      const outcome = await this.dispatch(slot, filePath);
      // 有成功就说明环境是好的，重置补位计数
      this.replacementCount = 0;
      this.lastEngine = outcome.engine;
      return outcome;
    } finally {
      if (estimatedBytes >= RETIRE_AFTER_BYTES) {
        this.retire(slot);
      } else {
        this.release(slot);
      }
    }
  }

  terminate(): void {
    this.closed = true;
    for (const slot of this.slots) {
      slot.alive = false;
      void slot.worker.terminate();
    }
  }

  // ----------------------------------------------------------
  // 线程生命周期
  // ----------------------------------------------------------

  /** 新建线程并登记；有等待者时直接交付 */
  private spawn(): void {
    let slot: PoolWorker;
    try {
      slot = {
        worker: createThumbnailWorker({
          resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_LIMIT_MB },
        }),
        alive: true,
      };
    } catch (error) {
      const failure = new Error(`缩略图工作线程启动失败：${(error as Error).message}`);
      this.failWaiters(failure);
      // 一个都不剩才算池子报废；否则交给其它存活线程继续跑
      if (this.slots.length === 0) {
        this.broken = failure;
      }
      return;
    }

    slot.worker.on('error', () => this.markDead(slot));
    slot.worker.on('exit', () => this.markDead(slot));
    this.slots.push(slot);

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(slot);
      return;
    }
    this.idle.push(slot);
  }

  /** 把线程从池子里摘掉（不结束它的进程） */
  private detach(slot: PoolWorker): void {
    slot.alive = false;

    const slotIndex = this.slots.indexOf(slot);
    if (slotIndex >= 0) {
      this.slots.splice(slotIndex, 1);
    }
    const idleIndex = this.idle.indexOf(slot);
    if (idleIndex >= 0) {
      this.idle.splice(idleIndex, 1);
    }
  }

  /** 主动结束一个线程并补位，用来释放它残留的内存 */
  private retire(slot: PoolWorker): void {
    if (!slot.alive) {
      return;
    }
    this.detach(slot);
    void slot.worker.terminate();

    if (!this.closed) {
      this.spawn();
    }
  }

  /** 线程退出或异常：移出池子并补一个新的，保持规模不变 */
  private markDead(slot: PoolWorker): void {
    if (!slot.alive) {
      return;
    }
    this.detach(slot);

    if (this.closed) {
      return;
    }

    this.replacementCount += 1;
    if (this.replacementCount > MAX_REPLACEMENTS) {
      this.broken = new Error('缩略图工作线程反复退出，已停止补位');
      this.failWaiters(this.broken);
      return;
    }
    this.spawn();
  }

  private failWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  // ----------------------------------------------------------
  // 借用与派发
  // ----------------------------------------------------------

  private acquire(): Promise<PoolWorker> {
    if (this.broken) {
      return Promise.reject(this.broken);
    }

    const slot = this.idle.pop();
    if (slot && slot.alive) {
      return Promise.resolve(slot);
    }

    return new Promise<PoolWorker>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private release(slot: PoolWorker): void {
    // 已关闭或已死亡的线程直接丢弃，绝不能回到空闲队列
    if (this.closed || !slot.alive) {
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(slot);
      return;
    }
    this.idle.push(slot);
  }

  /** 派发一张图片并等待回复；超时视为该线程卡死，弃用它 */
  private dispatch(slot: PoolWorker, filePath: string): Promise<ThumbnailOutcome> {
    const id = ++this.nextId;

    return new Promise<ThumbnailOutcome>((resolve, reject) => {
      let settled = false;

      const finish = (error: Error | null, outcome?: ThumbnailOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        slot.worker.off('message', onMessage);
        slot.worker.off('error', onError);
        slot.worker.off('exit', onExit);

        if (error) {
          reject(error);
        } else {
          resolve(outcome ?? { thumbnail: null, engine: 'builtin' });
        }
      };

      const timer = setTimeout(() => {
        this.markDead(slot);
        finish(new Error(`缩略图处理超时（${REQUEST_TIMEOUT_MS / 1000}s）`));
      }, REQUEST_TIMEOUT_MS);

      const onMessage = (response: ThumbnailResponse): void => {
        if (response.id !== id) {
          return;
        }
        if (response.error) {
          finish(new Error(`缩略图处理失败：${response.error}`));
        } else {
          finish(null, { thumbnail: response.thumbnail ?? null, engine: response.engine ?? 'builtin' });
        }
      };
      const onError = (error: Error): void => {
        finish(new Error(`缩略图工作线程异常：${error.message}`));
      };
      const onExit = (code: number): void => {
        finish(new Error(`缩略图工作线程已退出（code=${code}）`));
      };

      slot.worker.on('message', onMessage);
      slot.worker.on('error', onError);
      slot.worker.on('exit', onExit);

      try {
        slot.worker.postMessage({ id, filePath } satisfies ThumbnailRequest);
      } catch (error) {
        finish(new Error(`缩略图任务派发失败：${(error as Error).message}`));
      }
    });
  }
}

/** 线程数：至少 1，最多 {@link MAX_WORKERS}，并给主进程留一个核 */
function resolvePoolSize(): number {
  return Math.max(1, Math.min(MAX_WORKERS, cpus().length - 1));
}
