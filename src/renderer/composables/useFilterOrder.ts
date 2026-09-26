import { ref } from 'vue';

/**
 * 管理筛选标签的顺序。
 *
 * 标签栏按用户启用筛选的先后排列，所以启用时要把它挪到末尾；启用与停用
 * 都会触发一次回调，通常用来把列表重置回第一页。
 *
 * @param onOrderChange 顺序变化后的回调
 */
export function useFilterOrder(onOrderChange: () => void) {
  const order = ref<string[]>([]);

  /** 启用某个筛选条件 */
  function activate(key: string): void {
    order.value = [...order.value.filter((item) => item !== key), key];
    onOrderChange();
  }

  /** 停用某个筛选条件 */
  function deactivate(key: string): void {
    order.value = order.value.filter((item) => item !== key);
    onOrderChange();
  }

  return { order, activate, deactivate };
}
