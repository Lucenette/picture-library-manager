// ============================================================
// 加载服务（渲染进程侧）
//
// 任务表在主进程登记（见 src/main/loading/），这里只管三件事：
//   · 收下发的任务 → 按 id 找本地实现 → 跑完回执；
//   · 持有加载页要显示的状态（模块级，跨页面挂载不丢，也不怕推送比页面更早到）；
//   · 把「已就绪」告诉主进程——它收到之后才开始下发渲染进程任务。
// ============================================================

import { ref, type Ref } from 'vue';
import { ipcRenderer, type IpcRendererEvent } from 'electron';

import { IPC } from '@common/ipcChannels';
import type { LoadProgress, LoadTaskRequest, LoadTaskResult } from '@common/types';

/** 加载页读的状态；主进程还没报过进展时为 null（此时什么都不画） */
export const loadState: Ref<LoadProgress | null> = ref(null);

/** 本进程能认领的任务：id 是跨进程契约，见 common/ipcChannels.ts 的 LOAD_TASK */
const tasks = new Map<string, () => Promise<unknown>>();

/** 登记一个渲染进程任务；实现放在本进程，调度由主进程按 id 触发 */
export function registerRendererTask(id: string, run: () => Promise<unknown>): void {
  tasks.set(id, run);
}

/** 失败页点「退出」：主进程等这一下才会结束进程 */
export function quitLoading(): void {
  ipcRenderer.send(IPC.LOAD_QUIT);
}

/**
 * 挂上进度订阅与任务下发，并把就绪告诉主进程。
 *
 * 在渲染进程入口里、路由挂载之前调用：一 invoke 主进程就知道可以下发任务了。
 */
export async function initRendererLoading(): Promise<void> {
  ipcRenderer.on(IPC.LOAD_PROGRESS, (_event: IpcRendererEvent, next: LoadProgress) => {
    loadState.value = next;
  });
  ipcRenderer.on(IPC.LOAD_TASK, (_event: IpcRendererEvent, request: LoadTaskRequest) => {
    void runTask(request);
  });

  // 先订阅再取快照：主进程比这一页更快时，快照里已经是终态
  const snapshot = (await ipcRenderer.invoke(IPC.LOAD_STATE)) as LoadProgress | null;
  if (snapshot !== null) {
    loadState.value = snapshot;
  }
}

/** 跑一个下发的任务，无论成败都把结果回执给主进程 */
async function runTask(request: LoadTaskRequest): Promise<void> {
  const run = tasks.get(request.id);
  let error = '';
  try {
    if (run === undefined) {
      throw new Error(`渲染进程不认识的加载任务：${request.id}`);
    }
    await run();
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const result: LoadTaskResult = { requestId: request.requestId, error };
  ipcRenderer.send(IPC.LOAD_TASK_DONE, result);
}
