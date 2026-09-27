// ============================================================
// 脚本文件与草稿的落盘
//
// 脚本正文是用户资产，放在用户目录的 `scripts/` 下（不是 `data/scripts/`）；
// 没保存的编辑草稿是临时状态，放在用户目录的 `temp/scripts/` 下，一稿一文件。
// 这里只管文件，不碰数据库。
// ============================================================

import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import type { ScriptDraft } from '@common/types';

import { getScriptsDir, getTempDir } from '@/paths';

/** 脚本文件一律 `.js`：CommonJS，主进程用 Module#_compile 编译它 */
const SCRIPT_EXTENSION = '.js';

// ------------------------------------------------------------
// 脚本文件
// ------------------------------------------------------------

/** 脚本目录：没有就建 */
export async function ensureScriptsDir(): Promise<void> {
  await mkdir(getScriptsDir(), { recursive: true });
}

/** 给一份新脚本分配路径：文件名用 UUID，名称与它无关，由库里的 name 展示 */
export function newScriptPath(): string {
  return join(getScriptsDir(), `${randomUUID()}${SCRIPT_EXTENSION}`);
}

/**
 * 原子写文件：先写同目录的临时文件再改名。
 *
 * 脚本文件是唯一副本，写到一半崩掉会毁掉正文；改名在 Windows 上也会替换已存在的目标。
 */
export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const temp = `${target}.tmp`;
  await writeFile(temp, content, 'utf-8');
  await rename(temp, target);
}

/** 读脚本正文 */
export function readScriptFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

/** 已读过的脚本内容：按 path + mtime + size 缓存 */
const sourceCache = new Map<string, { mtimeMs: number; size: number; code: string }>();

/**
 * 读脚本正文；内容没变就复用上一次读到的。
 *
 * 每次都 stat 一次（异步、开销可忽略）：外部改了文件，或者保存后 mtime 变了，下一次调用
 * 就会重新读——「运行时重新加载并编译」靠的就是这个；文件不存在时 stat 抛 ENOENT，交给调用方说明。
 */
export async function readScriptSource(filePath: string): Promise<string> {
  const info = await stat(filePath);
  const cached = sourceCache.get(filePath);
  if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return cached.code;
  }
  const code = await readFile(filePath, 'utf-8');
  sourceCache.set(filePath, { mtimeMs: info.mtimeMs, size: info.size, code });
  return code;
}

/** 脚本文件还在不在 */
export async function scriptFileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** 删脚本文件；本来就不在算成功 */
export async function removeScriptFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ------------------------------------------------------------
// 草稿
//
// 形状照 VS Code 的 hot exit：每个脏的编辑器各有一份备份，保存后立刻丢掉。
// 一稿一文件意味着只有改动的那一份被重写，某一份坏了也不牵连其它。
// ------------------------------------------------------------

/** 草稿目录 */
function draftsDir(): string {
  return join(getTempDir(), 'scripts');
}

/** 一份草稿的文件路径；key 由调用方保证不含路径分隔符 */
function draftPath(key: string): string {
  return join(draftsDir(), `${key}.json`);
}

/** 读一份草稿；没有或内容坏了都当没有 */
export async function readDraft(key: string): Promise<ScriptDraft | null> {
  try {
    const text = await readFile(draftPath(key), 'utf-8');
    const parsed = JSON.parse(text) as Partial<ScriptDraft>;
    if (typeof parsed.code !== 'string' || typeof parsed.name !== 'string') {
      return null;
    }
    return {
      key,
      name: parsed.name,
      code: parsed.code,
      // 只有「新建未保存」的草稿带得动分组，缺字段的老草稿就是「未分组」
      groupId: typeof parsed.groupId === 'number' ? parsed.groupId : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** 写一份草稿 */
export async function writeDraft(draft: ScriptDraft): Promise<void> {
  await mkdir(draftsDir(), { recursive: true });
  await writeFileAtomic(draftPath(draft.key), JSON.stringify(draft, null, 2));
}

/** 删一份草稿；不在就算成功 */
export async function removeDraft(key: string): Promise<void> {
  try {
    await unlink(draftPath(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/** 列出全部草稿；坏掉的单个文件跳过，不影响其它 */
export async function listDrafts(): Promise<ScriptDraft[]> {
  let names: string[];
  try {
    names = await readdir(draftsDir());
  } catch {
    return [];
  }

  const drafts: ScriptDraft[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const draft = await readDraft(name.slice(0, -'.json'.length));
    if (draft !== null) {
      drafts.push(draft);
    }
  }
  return drafts;
}
