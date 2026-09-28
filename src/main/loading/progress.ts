// ============================================================
// 加载服务的状态与通道
//
// 状态只有一份、只在主进程：任务的进展、任务名与终态都汇到这里，再推给加载页。
// 渲染进程任务的「就绪握手」也归这里——下发与回执是一件事，只该实现一次。
// ============================================================

import { ipcMain, type IpcMainEvent } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { LoadProgress, LoadTaskRequest, LoadTaskResult } from '@common/types';

import { get } from '@/window-manager';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 还没有任何进展时的底：任务报第一条进展时以它为基础 */
const EMPTY: LoadProgress = {
  status: 'running',
  title: '',
  step: '',
  done: 0,
  total: 0,
  percent: 0,
  error: '',
  note: '',
};

/** 任务对状态的增补：任务名与终态由加载服务写，任务只填自己这一步的进展 */
export interface LoadTaskPatch {
  /** 当前步骤的说明 */
  step?: string;
  done?: number;
  total?: number;
  percent?: number;
  /** 失败时要一起显示的附注（升级是备份路径） */
  note?: string;
}

/** 任务把进展报给加载服务的方式 */
export type LoadTaskReport = (patch: LoadTaskPatch) => void;

/** 当前状态；null = 还没有任务报过进展，加载页据此什么都不画 */
let latest: LoadProgress | null = null;
/** 下一个公布的状态里写的任务名 */
let currentTask = '';

/** 渲染进程是否挂上了任务下发（它 invoke 一次 LOAD_STATE 就算就绪） */
let rendererReady = false;
/** 主窗口已经关掉：没人回执了，等就绪的与等下发的都要立刻收场 */
let rendererGone = false;
/** 等渲染进程就绪的挂起者 */
const readyWaiters: (() => void)[] = [];
/** 已下发、还没回执的渲染进程任务，按 requestId 找唤醒方 */
const pendingTasks = new Map<number, (error: string) => void>();
let nextRequestId = 1;

/** 失败页点「退出」后要唤醒的那个等待 */
let quit: (() => void) | null = null;

// ------------------------------------------------------------
// 通道
// ------------------------------------------------------------

/**
 * 注册加载服务的通道。
 *
 * 必须在窗口建好之后、登记任务之前调用：渲染进程一挂载就会 invoke LOAD_STATE，
 * 那既是取当前状态，也是「渲染进程任务可以下发了」的信号。
 */
export function initLoadingIpc(): void {
  ipcMain.handle(IPC.LOAD_STATE, (): LoadProgress | null => {
    markRendererReady();
    return latest;
  });

  ipcMain.on(IPC.LOAD_QUIT, () => {
    const current = quit;
    quit = null;
    current?.();
  });

  ipcMain.on(IPC.LOAD_TASK_DONE, (_event: IpcMainEvent, result: LoadTaskResult) => {
    const settle = pendingTasks.get(result.requestId);
    if (settle === undefined) {
      return;
    }
    pendingTasks.delete(result.requestId);
    settle(result.error);
  });

  // 窗口关掉就没人回执了：挂上唤醒，别让启动等一个永远不会回来的回执
  get('main')?.once('closed', markRendererGone);
}

/** 等用户在失败页点「退出」 */
export function waitLoadQuit(): Promise<void> {
  return new Promise((resolve) => {
    quit = resolve;
  });
}

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/**
 * 进入一个「必须」的任务。
 *
 * 只记下任务名、不推送：没有进展时推一条空状态会让加载页白闪一下（正常启动根本没有要加载的东西）。
 */
export function beginLoadTask(title: string): void {
  currentTask = title;
}

/** 任务报了进展才推给加载页 */
export function reportLoadProgress(patch: LoadTaskPatch): void {
  publish({ ...(latest ?? EMPTY), status: 'running', title: currentTask, ...patch });
}

/** 公布终态：加载页切主界面 / 停在失败页的唯一依据 */
export function finishLoad(status: 'succeeded' | 'failed', error: string): void {
  publish({ ...(latest ?? EMPTY), status, title: currentTask, error });
}

// ------------------------------------------------------------
// 下发渲染进程任务
// ------------------------------------------------------------

/**
 * 把任务下发给渲染进程并等回执。
 *
 * 渲染进程还没就绪就先等它；主窗口已经关掉就直接失败——启动不能被一个永远不回来的回执挂住。
 */
export async function dispatchLoadTask(id: string): Promise<void> {
  await waitRendererReady();

  const mainWindow = get('main');
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('main window is closed, cannot run renderer tasks');
  }

  const requestId = nextRequestId;
  nextRequestId += 1;
  const result = new Promise<string>((resolve) => {
    pendingTasks.set(requestId, resolve);
  });
  const request: LoadTaskRequest = { requestId, id };
  mainWindow.webContents.send(IPC.LOAD_TASK, request);

  const error = await result;
  if (error !== '') {
    throw new Error(error);
  }
}

// ------------------------------------------------------------
// 内部
// ------------------------------------------------------------

/** 记下快照并推给加载页；窗口已关就只更新快照 */
function publish(next: LoadProgress): void {
  latest = next;
  const mainWindow = get('main');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.LOAD_PROGRESS, next);
  }
}

/** 渲染进程就绪：唤醒所有等它的下发 */
function markRendererReady(): void {
  rendererReady = true;
  for (const wake of readyWaiters.splice(0)) {
    wake();
  }
}

/** 主窗口关掉：等就绪的醒过来走失败分支，已下发等回执的按失败收场 */
function markRendererGone(): void {
  rendererGone = true;
  for (const wake of readyWaiters.splice(0)) {
    wake();
  }
  for (const [requestId, settle] of pendingTasks) {
    pendingTasks.delete(requestId);
    settle('main window is closed, task got no reply');
  }
}

/** 等渲染进程挂上下发监听 */
async function waitRendererReady(): Promise<void> {
  if (rendererReady) {
    return;
  }
  if (rendererGone) {
    throw new Error('main window is closed, cannot run renderer tasks');
  }
  await new Promise<void>((resolve) => {
    readyWaiters.push(resolve);
  });
  if (!rendererReady) {
    throw new Error('main window is closed, cannot run renderer tasks');
  }
}
