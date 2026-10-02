import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 在组件挂载时订阅主进程推送，并在卸载时自动注销。
 *
 * 主窗口的页面会随路由反复挂载/卸载，订阅必须成对注销，否则同一个事件
 * 会被累积的监听器处理多次（例如一次扫描被触发多遍）。
 *
 * @param channel 主进程推送的通道名
 * @param handler 收到消息时的处理函数，参数类型由调用方声明；可以是异步的，返回的 Promise 不再被等待
 */
export function useIpcListener<T extends unknown[]>(
  channel: string,
  handler: (...args: T) => void | Promise<void>,
): void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
    void handler(...(args as T));
  };

  onMounted(() => ipcRenderer.on(channel, listener));
  onBeforeUnmount(() => ipcRenderer.removeListener(channel, listener));
}
