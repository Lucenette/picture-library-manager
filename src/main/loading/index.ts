// ============================================================
// 加载服务（主进程侧）
//
// 启动阶段的所有事都登记成任务交给它跑：登记与调度见 registry.ts，状态与通道见 progress.ts。
// 任务分两类——必须的（跑完才进主界面，失败停在错误页）与预热的（并行跑，不拦界面）；
// 分不分进程由 target 表示，渲染进程任务下发过去等回执。渲染进程那一半在 src/renderer/loading/。
//
// 为什么要单抽一层：升级的成败、其余通道的注册、渲染进程的预热原本散在启动流程里，
// 「谁先谁后」只写在注释里；现在启动顺序就是一张登记表，终态也在所有必须任务之后统一公布，
// 于是「加载页收到终态时通道必然已注册好」从一条要靠人守的约定变成了结构上的事实。
// ============================================================

export { initLoadingIpc, waitLoadQuit } from '@/loading/progress';
export type { LoadTaskPatch, LoadTaskReport } from '@/loading/progress';
export { registerLoadTask, startLoading } from '@/loading/registry';
export type { LoadTask, LoadTaskKind } from '@/loading/registry';
