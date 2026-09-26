/**
 * electron-vite 的 vite:node-worker 插件约定：以 `?nodeWorker` 结尾的导入
 * 会被替换成「创建该模块 worker 线程」的工厂函数，模块本身产出独立的 chunk。
 */
declare module '*?nodeWorker' {
  import type { Worker, WorkerOptions } from 'worker_threads';

  const createWorker: (options?: WorkerOptions) => Worker;
  export default createWorker;
}

/**
 * Vite 的原始文本导入：以 `?raw` 结尾的导入会被替换成该文件的完整文本。
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
