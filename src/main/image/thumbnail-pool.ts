import { cpus } from 'os';
import type { Worker } from 'worker_threads';
import createThumbnailWorker from '@/image/thumbnail-worker?nodeWorker';
import type { ThumbnailMetrics, ThumbnailRequest, ThumbnailResponse } from '@/image/thumbnail-decode';

/** 线程数上限：留出核心给主进程与渲染进程 */
const MAX_WORKERS = 4;

/**
 * 缩略图线程池。
 *
 * 一个线程同时只处理一张图，借用与归还可保证消息与回复一一对应；
 * 线程创建失败或中途崩溃都会以可读错误抛出，由任务层记进任务详情。
 */
export class ThumbnailPool {
  private readonly workers: Worker[];
  private readonly idle: Worker[] = [];
  private readonly waiters: Array<(worker: Worker) => void> = [];
  private nextId = 0;

  constructor(size: number = resolvePoolSize()) {
    this.workers = Array.from({ length: size }, () => createThumbnailWorker());
    this.idle.push(...this.workers);
  }

  get concurrency(): number {
    return this.workers.length;
  }

  async analyze(filePath: string): Promise<ThumbnailMetrics> {
    const worker = await this.acquire();
    try {
      return await this.dispatch(worker, filePath);
    } finally {
      this.release(worker);
    }
  }

  terminate(): void {
    for (const worker of this.workers) {
      void worker.terminate();
    }
  }

  private acquire(): Promise<Worker> {
    const worker = this.idle.pop();
    if (worker) {
      return Promise.resolve(worker);
    }

    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(worker: Worker): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(worker);
      return;
    }
    this.idle.push(worker);
  }

  /** 派发一张图片并等待回复 */
  private dispatch(worker: Worker, filePath: string): Promise<ThumbnailMetrics> {
    const id = ++this.nextId;

    return new Promise<ThumbnailMetrics>((resolve, reject) => {
      const cleanup = (): void => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const onMessage = (response: ThumbnailResponse): void => {
        if (response.id !== id) {
          return;
        }
        cleanup();
        if (response.error) {
          reject(new Error(`缩略图处理失败：${response.error}`));
        } else {
          resolve(response.metrics!);
        }
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(new Error(`缩略图工作线程异常：${error.message}`));
      };
      const onExit = (code: number): void => {
        cleanup();
        reject(new Error(`缩略图工作线程已退出（code=${code}）`));
      };

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      worker.postMessage({ id, filePath } satisfies ThumbnailRequest);
    });
  }
}

/** 线程数：至少 1，最多 {@link MAX_WORKERS}，并给主进程留一个核 */
function resolvePoolSize(): number {
  return Math.max(1, Math.min(MAX_WORKERS, cpus().length - 1));
}
