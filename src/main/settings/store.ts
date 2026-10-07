import { mkdir, readFile } from 'fs/promises';
import { dirname } from 'path';

import { nativeTheme } from 'electron';

import { DEFAULT_SETTINGS, type Settings, type SettingsUpdateResult } from '@common/settings';
import type { ThemeName } from '@common/theme';

import { createLogger } from '@/log';
import { getSettingsPath } from '@/paths';
import { writeFileAtomic } from '@/script/files';

import { parseSettings, sanitizePatch, serializeSettings } from './schema';

// ============================================================
// 设置的内存态与落盘
//
// 只有主进程读写设置文件。启动时读一次进内存，之后以内存为准，改动整份写回；
// 渲染进程只拿快照、只提交改动（见 settings/ipc.ts）。
// ============================================================

/** 本模块的日志（category `main.settings`） */
const log = createLogger('settings');

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 当前设置；启动前是默认值 */
let current: Settings = { ...DEFAULT_SETTINGS };

/** 文件里我们不认识的键：写回时带回去，别的版本写的键不会被这一版抹掉 */
let unknown: Record<string, unknown> = {};

/** 设置变化的订阅者：窗口配色与渲染进程广播 */
const listeners = new Set<(settings: Settings) => void>();

/** 写盘串行化：两次改动几乎同时到达时，后一次必须等前一次落定后再读快照，否则会拿旧值算新值 */
let pending: Promise<unknown> = Promise.resolve();

// ------------------------------------------------------------
// 读写
// ------------------------------------------------------------

/**
 * 读一次设置进内存。
 *
 * **必须在建任何窗口之前调用**：窗口底色与系统按钮字形色在建窗口时就定了，晚一步就会先闪一下
 * 系统主题。文件不存在是正常状态（还没改过任何设置），此时不主动创建文件。
 */
export async function initSettings(): Promise<void> {
  let text: string;
  try {
    text = await readFile(getSettingsPath(), 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('failed to read settings file, using defaults', error);
    } else {
      // 还没改过任何设置：不主动创建文件，第一次改动时才落盘
      log.info('settings file not found, using defaults');
    }
    current = { ...DEFAULT_SETTINGS };
    unknown = {};
    applyThemeSource(current.theme);
    return;
  }

  const parsed = parseSettings(text);
  for (const reason of parsed.errors) {
    log.error('settings file problem: ' + reason);
  }
  current = parsed.settings;
  unknown = parsed.unknown;
  applyThemeSource(current.theme);
  log.info(`settings loaded, theme: ${current.theme}`);
}

/** 当前设置（内存态） */
export function getSettings(): Settings {
  return current;
}

/**
 * 改一项或几项：校验 → 落盘 → 更新内存 → 通知订阅者。
 *
 * 写盘失败就整条不动——宁可这次改动没生效，也不要内存里是新值、文件里是旧值。
 */
export function updateSettings(raw: unknown): Promise<SettingsUpdateResult> {
  const { patch, errors } = sanitizePatch(raw);
  if (errors.length > 0) {
    return Promise.resolve({ ok: false, settings: current, errors });
  }

  const task = pending.then(() => applyPatch(patch));
  // 队列不能因为某一次失败就断掉：失败已经变成返回值，这里只负责让下一次接着排队
  pending = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** 订阅设置变化；返回注销函数 */
export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 落一次改动；在队列里调用，所以读到的一定是最新快照 */
async function applyPatch(patch: Partial<Settings>): Promise<SettingsUpdateResult> {
  const next: Settings = { ...current, ...patch };
  try {
    // 用户目录可能还不存在（打包后是第一次运行、也还没写过任何设置）
    await mkdir(dirname(getSettingsPath()), { recursive: true });
    await writeFileAtomic(getSettingsPath(), serializeSettings(next, unknown));
  } catch (error) {
    log.error('failed to write settings file', error);
    return { ok: false, settings: current, errors: ['设置文件写入失败，改动未生效（详见日志）'] };
  }

  current = next;
  applyThemeSource(current.theme);
  log.info(`settings updated: ${Object.keys(patch).join(', ')}`);
  for (const listener of listeners) {
    listener(current);
  }
  return { ok: true, settings: current, errors: [] };
}

/**
 * 把偏好交给 Electron。
 *
 * 设成**偏好**而不是解析结果：`system` 时要保持跟随系统，钉死成当时的取值就不再跟了
 * （见 docs/design/theme.md 第 5 节）。它同时决定渲染进程里 `prefers-color-scheme` 的结果。
 */
function applyThemeSource(preference: ThemeName): void {
  nativeTheme.themeSource = preference;
}
