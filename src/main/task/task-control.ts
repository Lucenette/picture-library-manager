// ============================================================
// 单个任务的运行控制：暂停、继续、取消
//
// 任务是协作式的：runner 在每个处理单元之间调用 checkpoint()，
// 暂停与取消都只在这些边界生效。同步的解码/复制过程无法被打断，
// 因此单元粒度决定了暂停与取消的响应延迟。
// ============================================================

/** 任务被取消时由 checkpoint 抛出，供 TaskManager 识别 */
export class TaskCancelledError extends Error {
  constructor() {
    super('任务已取消');
    this.name = 'TaskCancelledError';
  }
}

/** 让出一次事件循环，保证主进程仍能处理窗口消息与 IPC */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class TaskControl {
  private paused = false;
  private aborted = false;
  private resumeWaiters: Array<() => void> = [];

  get isPaused(): boolean {
    return this.paused;
  }

  /** 暂停：runner 会在下一个检查点挂起 */
  pause(): void {
    this.paused = true;
  }

  /** 继续被暂停的任务 */
  resume(): void {
    if (!this.paused) {
      return;
    }

    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const wake of waiters) {
      wake();
    }
  }

  /** 取消：唤醒可能挂起的 runner，并让它在检查点抛出 */
  abort(): void {
    this.aborted = true;
    this.resume();
  }

  /**
   * 单元边界检查点：暂停时挂起，取消时抛出。
   *
   * 无论如何都会让出一次事件循环。
   */
  async checkpoint(): Promise<void> {
    if (this.paused) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
    if (this.aborted) {
      throw new TaskCancelledError();
    }
    await yieldToEventLoop();
  }
}
