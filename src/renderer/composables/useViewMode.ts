import { ref } from 'vue';

/** 视图模式：列表（表格）与平铺（相册式两级） */
export type ViewMode = 'list' | 'tile';

/** localStorage 的键前缀；一个页面一个键，互不影响 */
const STORAGE_PREFIX = 'view-mode:';

/**
 * 读某一页存下的视图偏好。
 *
 * 读不到、或存的是不认识的值（手工改过、旧版本留下的），一律退回列表：
 * 表格是信息最全的入口，退化到它不会让人丢掉任何功能。
 */
function readMode(key: string): ViewMode {
  const stored = localStorage.getItem(STORAGE_PREFIX + key);
  if (stored === 'tile' || stored === 'list') {
    return stored;
  }
  return 'list';
}

/**
 * 记住某一页的视图偏好，存在 localStorage 里。
 *
 * @param key 页面标识（library / process），与 STORAGE_PREFIX 拼成键
 */
export function useViewMode(key: string) {
  const mode = ref<ViewMode>(readMode(key));

  /** 在列表与平铺之间切换；偏好立刻落盘，刷新后还是这个视图 */
  function toggle(): void {
    mode.value = mode.value === 'list' ? 'tile' : 'list';
    localStorage.setItem(STORAGE_PREFIX + key, mode.value);
  }

  return { mode, toggle };
}
