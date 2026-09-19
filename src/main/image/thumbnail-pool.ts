import { cpus } from 'os';
import type { Worker } from 'worker_threads';
import createThumbnailWorker from '@/image/thumbnail-worker?nodeWorker';
import type { ThumbnailEngineName } from '@common/types';
import type { ThumbnailRequest, ThumbnailResponse } from '@/image/thumbnail-worker';

/** 线程数上限：留出核心给主进程与渲染进程 */
const MAX_WORKERS = 4;

/**
 * 单个线程的 V8 堆上限。
 *
 * 它只管 V8 堆：sharp（libvips）的解码缓冲在堆外，不受此限制，
 * 这里只是防止纯 JS 侧的对象把线程堆撑爆。
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

/** 一次缩略图生成的结果：缩略图本体 + 原图宽高（读不出来时为 0） */
interface ThumbnailOutcome {
  thumbnail: string | null;
  width: number;
  height: number;
  engine: ThumbnailEngineName;
}

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

  /** 生成一张缩略图，并返回从 sharp 读到的原图宽高 */
  async analyze(filePath: string): Promise<ThumbnailOutcome> {
    const slot = await this.acquire();
    try {
      const outcome = await this.dispatch(slot, filePath);
      // 有成功就说明环境是好的，重置补位计数
      this.replacementCount = 0;
      this.lastEngine = outcome.engine;
      return outcome;
    } finally {
      this.release(slot);
    }
  }

  /**
   * 立刻收掉全部线程。
   *
   * worker 线程会阻止主进程退出，所以这一步必须能从任务之外触发（强制结束、退出），
   * 不能只依赖 runner 走到下一个检查点。可重复调用。
   */
  terminate(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;

    // 等待中的请求必须立刻失败，否则 terminate 之后它们永远不结算
    this.failWaiters(new Error('缩略图线程池已关闭'));

    for (const slot of this.slots) {
      slot.alive = false;
      void slot.worker.terminate();
    }
    this.slots.length = 0;
    this.idle.length = 0;
  }

  // ----------------------------------------------------------
  // 线程生命周期
  // ----------------------------------------------------------

  /** 新建线程并登记；有等待者时直接交付 */
  private spawn(): void {
    let slot: PoolWorker;
    try {
      const worker = createThumbnailWorker({
        resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_LIMIT_MB },
      });
      // 刻意 unref：线程池不该成为「窗口关了进程还不退」的原因，
      // 进程寿命由窗口与任务决定，线程的回收走 terminate()
      worker.unref();
      slot = { worker, alive: true };
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
          resolve(outcome ?? { thumbnail: null, width: 0, height: 0, engine: 'sharp' });
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
          finish(null, {
            thumbnail: response.thumbnail ?? null,
            width: response.width ?? 0,
            height: response.height ?? 0,
            engine: response.engine ?? 'sharp',
          });
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
