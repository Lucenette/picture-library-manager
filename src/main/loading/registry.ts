// ============================================================
// 加载服务的任务表与调度
//
// 启动时该做哪些事都登记在这里，调度只看登记时给的两个标记：
//   · kind  essential = 必须跑完才放行主界面，加载页等它、显示它的进展，失败即整轮失败；
//           warmup    = 与必须的任务并行，跑完不放行、失败只记一条日志（预热属于这类）。
//   · target  main     = 加载服务直接跑；renderer = 下发到渲染进程、等回执。
// ============================================================

import {
  beginLoadTask, dispatchLoadTask, finishLoad, reportLoadProgress, type LoadTaskReport,
} from '@/loading/progress';
import { createLogger } from '@/log';

/** 本模块的日志（category `main.loading`） */
const log = createLogger('loading');

/** 任务的调度种类 */
export type LoadTaskKind = 'essential' | 'warmup';

/** 跑在主进程的任务：加载服务直接 await 它，抛错即失败 */
export interface MainLoadTask {
  target: 'main';
  kind: LoadTaskKind;
  /** 加载页上的标题 */
  title: string;
  run: (report: LoadTaskReport) => Promise<void> | void;
}

/** 跑在渲染进程的任务：按 id 下发过去，实现由渲染进程认领 */
export interface RendererLoadTask {
  target: 'renderer';
  kind: LoadTaskKind;
  title: string;
  /** 渲染进程的认领键，见 common/ipcChannels.ts 的 LOAD_TASK */
  id: string;
}

export type LoadTask = MainLoadTask | RendererLoadTask;

/** 登记的任务；主进程「必须」任务的执行顺序就是登记顺序 */
const tasks: LoadTask[] = [];
/** 加载已经开始：此后不许再登记，否则会出现「登记了却没跑」 */
let started = false;

/** 登记一个加载任务；必须在 startLoading() 之前 */
export function registerLoadTask(task: LoadTask): void {
  if (started) {
    throw new Error('加载已经开始，不能再登记任务');
  }
  tasks.push(task);
}

/**
 * 跑一轮加载。
 *
 * 预热任务先全部起跑（不等它们），再按登记顺序跑「必须」的任务，最后公布终态。
 * 返回是否成功——失败时调用方该等用户点「退出」。
 */
export async function startLoading(): Promise<boolean> {
  started = true;

  for (const task of tasks) {
    if (task.kind !== 'warmup') {
      continue;
    }
    void runTask(task).catch((error: unknown) => {
      log.warn(`warmup task failed: ${task.title}`, error);
    });
  }

  for (const task of tasks) {
    if (task.kind !== 'essential') {
      continue;
    }
    beginLoadTask(task.title);
    try {
      await runTask(task);
    } catch (error: unknown) {
      log.error(`load task failed: ${task.title}`, error);
      finishLoad('failed', describeError(error));
      return false;
    }
  }

  finishLoad('succeeded', '');
  return true;
}

/** 任务一律经这里跑：主进程的直接跑，渲染进程的下发过去等回执 */
async function runTask(task: LoadTask): Promise<void> {
  if (task.target === 'main') {
    await task.run(reportLoadProgress);
    return;
  }
  await dispatchLoadTask(task.id);
}

/** 抛出物转可读文本 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
