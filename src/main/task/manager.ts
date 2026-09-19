import type { BrowserWindow } from 'electron';
import { IPC } from '@common/ipcChannels';
import type {
  ExportTaskPayload, ProcessTaskPayload, ScanTaskPayload,
  TaskMoveDirection, TaskPayload, TaskProgressEvent, TaskResult, TaskRow, TaskStatus, TaskType, TaskView,
} from '@common/types';
import {
  deleteFinishedTasks, finishTask, getAllTasks, getGalleryById, getMaxQueueOrder, getTaskRow,
  insertTask, markTaskPaused, markTaskRunning, resumeTask, updateTaskProgress, updateTaskQueueOrder,
} from '@/db';
import { TaskCancelledError, TaskControl } from '@/task/task-control';
import { runExport } from '@/task/runners/export';
import { runProcess } from '@/task/runners/process';
import { runScan } from '@/task/runners/scan';

// ------------------------------------------------------------
// 常量与类型
// ------------------------------------------------------------

/** 进度写库的最小间隔：内存与推送是实时的，落盘没必要跟着高频刷 */
const PROGRESS_PERSIST_INTERVAL_MS = 1000;

/** 终态集合 */
const FINISHED_STATUSES: readonly TaskStatus[] = ['done', 'failed', 'cancelled'];

/** runner 收到的运行上下文 */
export interface TaskContext {
  readonly taskId: number;
  readonly payload: TaskPayload;
  /** 上报进度（0~100）与阶段描述 */
  report(progress: number, message: string): void;
  /** 单元边界：暂停挂起、取消抛出、并让出事件循环 */
  checkpoint(): Promise<void>;
}

type TaskRunner = (context: TaskContext) => Promise<TaskResult>;

/** 任务类型与执行器的映射 */
const RUNNERS: Record<TaskType, TaskRunner> = {
  scan: runScan,
  process: runProcess,
  export: runExport,
};

/** 内存中的任务记录 */
interface ActiveTask {
  row: TaskRow;
  control: TaskControl;
  /** 提交时算好的展示标题，避免每次列列表都查库 */
  title: string;
}

// ------------------------------------------------------------
// 管理器
// ------------------------------------------------------------

class TaskManager {
  private readonly tasks = new Map<number, ActiveTask>();
  private notifyTarget: BrowserWindow | null = null;
  /** 当前占用的任务 id；全局只允许一个任务在跑 */
  private runningId: number | null = null;
  private lastPersistAt = 0;

  /** 绑定通知目标并恢复上次遗留的任务 */
  init(target: BrowserWindow): void {
    this.notifyTarget = target;
    this.restore();
  }

  /** 全部任务的视图，按「进行中 → 已暂停 → 待执行 → 终态」排列 */
  list(): TaskView[] {
    return [...this.tasks.values()].sort(compareForDisplay).map((task) => this.toView(task));
  }

  /** 提交新任务，返回任务 id */
  submit(type: TaskType, payload: TaskPayload): number {
    const id = insertTask(type, getMaxQueueOrder() + 1, JSON.stringify(payload));
    const row = getTaskRow(id)!;
    this.tasks.set(id, { row, control: new TaskControl(), title: buildTitle(type, payload) });

    this.notifyChanged(id);
    this.tick();
    return id;
  }

  /** 取消尚未开始的任务 */
  cancel(id: number): void {
    const task = this.tasks.get(id);
    if (!task || task.row.status !== 'pending') {
      return;
    }
    this.finish(task, 'cancelled', '已取消', '', '');
  }

  /** 暂停正在执行的任务 */
  pause(id: number): void {
    const task = this.tasks.get(id);
    if (!task || task.row.status !== 'running') {
      return;
    }

    task.control.pause();
    task.row.status = 'paused';
    markTaskPaused(id);
    this.notifyChanged(id);
  }

  /** 继续被暂停的任务 */
  resume(id: number): void {
    const task = this.tasks.get(id);
    if (!task || task.row.status !== 'paused') {
      return;
    }

    task.row.status = 'running';
    resumeTask(id);
    task.control.resume();
    this.notifyChanged(id);
  }

  /**
   * 强制结束正在执行或已暂停的任务。
   *
   * 状态立刻落到终态并释放队列，不等 runner 收尾；runner 会在下一个检查点
   * 抛出取消异常自行退出。由于写库被安排在最后一步且是同步的，这样做不会
   * 留下半成品。
   */
  forceStop(id: number): void {
    const task = this.tasks.get(id);
    if (!task) {
      return;
    }
    if (task.row.status !== 'running' && task.row.status !== 'paused') {
      return;
    }

    task.control.abort();
    this.finish(task, 'cancelled', '已强制结束', '', '');

    if (this.runningId === id) {
      this.runningId = null;
      this.tick();
    }
  }

  /** 调整待执行任务的顺序 */
  move(id: number, direction: TaskMoveDirection): void {
    const pending = this.pendingTasks();
    const index = pending.findIndex((task) => task.row.id === id);
    if (index < 0) {
      return;
    }

    const neighbour = pending[direction === 'up' ? index - 1 : index + 1];
    if (!neighbour) {
      return;
    }

    const current = pending[index];
    const currentOrder = current.row.queueOrder;
    current.row.queueOrder = neighbour.row.queueOrder;
    neighbour.row.queueOrder = currentOrder;

    updateTaskQueueOrder(current.row.id, current.row.queueOrder);
    updateTaskQueueOrder(neighbour.row.id, neighbour.row.queueOrder);

    this.notifyChanged(current.row.id);
    this.notifyChanged(neighbour.row.id);
  }

  /** 用同样的入参重新提交一个已结束的任务 */
  retry(id: number): number | null {
    const task = this.tasks.get(id);
    if (!task || !FINISHED_STATUSES.includes(task.row.status)) {
      return null;
    }
    return this.submit(task.row.type, JSON.parse(task.row.payload) as TaskPayload);
  }

  /** 清空全部终态任务 */
  clearFinished(): void {
    for (const [id, task] of this.tasks) {
      if (FINISHED_STATUSES.includes(task.row.status)) {
        this.tasks.delete(id);
      }
    }
    deleteFinishedTasks();
  }

  /**
   * 退出前的收尾：终止进行中的任务。
   *
   * 未开始的 pending 任务保留，下次启动继续排队；崩溃导致的残留会在
   * restore 里标记为中断。
   */
  shutdown(): void {
    for (const task of this.tasks.values()) {
      if (task.row.status !== 'running' && task.row.status !== 'paused') {
        continue;
      }
      task.control.abort();
      finishTask(task.row.id, 'cancelled', task.row.progress, '应用退出', '', '应用退出，任务已取消');
    }
  }

  // ----------------------------------------------------------
  // 队列
  // ----------------------------------------------------------

  /** 恢复上次遗留的任务：中断的标记失败，未开始的继续排队 */
  private restore(): void {
    for (const row of getAllTasks()) {
      if (row.status === 'running' || row.status === 'paused') {
        finishTask(row.id, 'failed', row.progress, '任务中断', '', '应用退出导致任务中断');
        row.status = 'failed';
        row.message = '任务中断';
        row.error = '应用退出导致任务中断';
      }
      this.tasks.set(row.id, {
        row,
        control: new TaskControl(),
        title: buildTitle(row.type, JSON.parse(row.payload) as TaskPayload),
      });
    }
    this.tick();
  }

  /** 取出队首任务开始执行 */
  private tick(): void {
    if (this.runningId !== null) {
      return;
    }

    const next = this.pendingTasks()[0];
    if (!next) {
      return;
    }

    this.runningId = next.row.id;
    markTaskRunning(next.row.id, '开始执行');
    next.row = getTaskRow(next.row.id) ?? next.row;
    this.notifyChanged(next.row.id);

    void this.run(next);
  }

  private async run(task: ActiveTask): Promise<void> {
    const taskId = task.row.id;

    try {
      const result = await RUNNERS[task.row.type](this.createContext(task));
      this.finish(task, 'done', '已完成', JSON.stringify(result), '');
    } catch (error) {
      if (error instanceof TaskCancelledError) {
        this.finish(task, 'cancelled', '已取消', '', '');
      } else {
        this.finish(task, 'failed', (error as Error).message, '', (error as Error).message);
      }
    } finally {
      // 强制结束时 runningId 已被释放，这里不能误清掉新任务的占用
      if (this.runningId === taskId) {
        this.runningId = null;
      }
      this.tick();
    }
  }

  private pendingTasks(): ActiveTask[] {
    return [...this.tasks.values()]
      .filter((task) => task.row.status === 'pending')
      .sort((left, right) => left.row.queueOrder - right.row.queueOrder || left.row.id - right.row.id);
  }

  /** 写入终态；已经结束的任务不重复处理（强制结束与 runner 退出会竞争） */
  private finish(task: ActiveTask, status: TaskStatus, message: string, result: string, error: string): void {
    if (FINISHED_STATUSES.includes(task.row.status)) {
      return;
    }

    finishTask(task.row.id, status, task.row.progress, message, result, error);
    task.row = getTaskRow(task.row.id) ?? task.row;
    this.notifyChanged(task.row.id);
  }

  // ----------------------------------------------------------
  // 上下文与事件
  // ----------------------------------------------------------

  private createContext(task: ActiveTask): TaskContext {
    return {
      taskId: task.row.id,
      payload: JSON.parse(task.row.payload) as TaskPayload,
      report: (progress, message) => this.reportProgress(task, progress, message),
      checkpoint: () => task.control.checkpoint(),
    };
  }

  private reportProgress(task: ActiveTask, progress: number, message: string): void {
    const value = Math.max(0, Math.min(100, Math.round(progress)));
    task.row.progress = value;
    task.row.message = message;
    this.send(IPC.TASK_PROGRESS, { id: task.row.id, progress: value, message } as TaskProgressEvent);

    const now = Date.now();
    if (now - this.lastPersistAt < PROGRESS_PERSIST_INTERVAL_MS) {
      return;
    }

    this.lastPersistAt = now;
    updateTaskProgress(task.row.id, value, message);
  }

  private toView(task: ActiveTask): TaskView {
    return {
      ...task.row,
      title: task.title,
      payload: JSON.parse(task.row.payload) as TaskPayload,
      result: task.row.result ? (JSON.parse(task.row.result) as TaskResult) : null,
    };
  }

  private notifyChanged(id: number): void {
    const task = this.tasks.get(id);
    if (task) {
      this.send(IPC.TASK_CHANGED, this.toView(task));
    }
  }

  private send(channel: string, payload: unknown): void {
    const target = this.notifyTarget;
    if (target && !target.isDestroyed()) {
      target.webContents.send(channel, payload);
    }
  }
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 生成任务标题；图库名这类上下文只有主进程拿得到 */
function buildTitle(type: TaskType, payload: TaskPayload): string {
  if (type === 'scan') {
    const { galleryId } = payload as ScanTaskPayload;
    const gallery = getGalleryById(galleryId);
    return `扫描图库「${gallery?.name ?? galleryId}」`;
  }
  if (type === 'process') {
    return `批量选图 ${(payload as ProcessTaskPayload).groupIds.length} 个图片组`;
  }
  return `导出 ${(payload as ExportTaskPayload).imageIds.length} 张图片`;
}

/** 列表排序权重：占用队列的排前面 */
function displayRank(status: TaskStatus): number {
  if (status === 'running') {
    return 0;
  }
  if (status === 'paused') {
    return 1;
  }
  if (status === 'pending') {
    return 2;
  }
  return 3;
}

function compareForDisplay(left: ActiveTask, right: ActiveTask): number {
  const rank = displayRank(left.row.status) - displayRank(right.row.status);
  if (rank !== 0) {
    return rank;
  }
  if (left.row.status === 'pending') {
    return left.row.queueOrder - right.row.queueOrder;
  }

  // 终态按提交时间倒序，最近结束的排前面
  return right.row.id - left.row.id;
}

/** 全局单例 */
export const taskManager = new TaskManager();
