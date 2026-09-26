import { copyFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import type { DatabaseSync } from 'node:sqlite';

import { DOMParser, type Element } from '@xmldom/xmldom';

import type { MigrationProgress } from '@common/types';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/**
 * 账本表定义。
 *
 * 账本由代码直接创建，不放进 changelog：它不存在时，没有任何地方能记录「创建账本」这件事。
 */
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS schema_migration (
  author         TEXT    NOT NULL,
  id             TEXT    NOT NULL,
  filename       TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  exectype       TEXT    NOT NULL CHECK(exectype IN ('executed','failed')),
  order_executed INTEGER NOT NULL,
  applied_at     TEXT    NOT NULL,
  execution_ms   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (author, id, filename)
)`;

/** 账本表名 */
const LEDGER_TABLE = 'schema_migration';

/** 升级前备份保留的份数 */
const BACKUP_KEEP = 5;

/** 备份文件名前缀 */
const BACKUP_PREFIX = 'pre-migration-';

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

/** 一个 changelog 文件；文件名是不含扩展名的应用版本号 */
export interface ChangeLogFile {
  filename: string;
  content: string;
}

/** 已解析的一条 changeset */
export interface ParsedChangeset {
  author: string;
  id: string;
  filename: string;
  title: string;
  sql: string;
}

/** 启动时的迁移计划 */
export interface ChangesetPlan {
  /** 尚未执行的 changeset，顺序即执行顺序 */
  pending: ParsedChangeset[];
}

/** 一次迁移的结果 */
export interface MigrationOutcome {
  ok: boolean;
  /** 主窗口已被关闭，迁移主动收手 */
  aborted: boolean;
  applied: number;
  error: string;
  backupPath: string;
}

/** 执行迁移所需的全部外部输入 */
export interface RunOptions {
  db: DatabaseSync;
  dbPath: string;
  backupsDir: string;
  files: readonly ChangeLogFile[];
  onProgress?: (progress: MigrationProgress) => void;
  shouldAbort?: () => boolean;
}

/** 账本里的一行 */
interface LedgerRow {
  author: string;
  id: string;
  filename: string;
  exectype: string;
}

// ------------------------------------------------------------
// 解析
// ------------------------------------------------------------

/** 身份键：账本按 (author, id, filename) 三元组记账 */
function keyOf(author: string, id: string, filename: string): string {
  return `${author}\u0000${id}\u0000${filename}`;
}

/** 标题取 <comment>，没有就退回 author:id */
function readTitle(node: Element, author: string, id: string): string {
  const first = node.getElementsByTagName('comment').item(0);
  const text = first ? first.textContent : null;
  const title = text ? text.trim() : '';
  return title === '' ? `${author}:${id}` : title;
}

/** <sql> 的正文；写了多条就按顺序拼接 */
function readSql(node: Element): string {
  const nodes = node.getElementsByTagName('sql');
  const parts: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const item = nodes.item(i);
    parts.push(item ? (item.textContent ?? '') : '');
  }
  return parts.join('\n').trim();
}

/** 解析一个 changelog 文件 */
function parseChangeLogFile(file: ChangeLogFile): ParsedChangeset[] {
  const parser = new DOMParser({
    // 不接这个回调，解析器只记一条日志就继续，返回的可能是半个文档
    onError: (_level, message) => {
      throw new Error(`changelog「${file.filename}」解析失败：${message}`);
    },
  });
  const doc = parser.parseFromString(file.content, 'text/xml');
  const nodes = doc.getElementsByTagName('changeSet');
  const result: ParsedChangeset[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes.item(i);
    if (!node) {
      continue;
    }
    const author = node.getAttribute('author') ?? '';
    const id = node.getAttribute('id') ?? '';
    if (author === '' || id === '') {
      throw new Error(`changelog「${file.filename}」里有 changeSet 缺少 id 或 author`);
    }
    const sql = readSql(node);
    if (sql === '') {
      throw new Error(`changelog「${file.filename}」的 changeset ${author}:${id} 里没有可执行的 <sql>`);
    }
    result.push({ author, id, filename: file.filename, title: readTitle(node, author, id), sql });
  }
  return result;
}

/** 按清单顺序把全部 changelog 展平 */
function parseChangeLog(files: readonly ChangeLogFile[]): ParsedChangeset[] {
  const all: ParsedChangeset[] = [];
  for (const file of files) {
    all.push(...parseChangeLogFile(file));
  }
  return all;
}

// ------------------------------------------------------------
// 账本
// ------------------------------------------------------------

/** 账本表是否已存在；只读，不建表 */
function ledgerExists(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', LEDGER_TABLE);
  return row !== undefined;
}

/** 读账本；账本不存在时视为一条都没跑过 */
function readLedger(db: DatabaseSync): LedgerRow[] {
  if (!ledgerExists(db)) {
    return [];
  }
  return db.prepare(`SELECT author, id, filename, exectype FROM ${LEDGER_TABLE}`).all() as unknown as LedgerRow[];
}

/** 写一条账本记录；同一个身份重跑时覆盖上一次的结果 */
function writeLedger(
  db: DatabaseSync,
  changeset: ParsedChangeset,
  exectype: 'executed' | 'failed',
  order: number,
  executionMs: number,
): void {
  db.prepare(
    `INSERT INTO ${LEDGER_TABLE} (author, id, filename, title, exectype, order_executed, applied_at, execution_ms)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)
     ON CONFLICT(author, id, filename) DO UPDATE SET
       title = excluded.title,
       exectype = excluded.exectype,
       order_executed = excluded.order_executed,
       applied_at = excluded.applied_at,
       execution_ms = excluded.execution_ms`,
  ).run(
    changeset.author,
    changeset.id,
    changeset.filename,
    changeset.title,
    exectype,
    order,
    executionMs,
  );
}

/** 下一个执行序号 */
function nextOrder(db: DatabaseSync): number {
  const row = db.prepare(`SELECT COALESCE(MAX(order_executed), 0) + 1 AS next FROM ${LEDGER_TABLE}`).get() as unknown as { next: number };
  return Number(row.next);
}

// ------------------------------------------------------------
// 计划
// ------------------------------------------------------------

/**
 * 算出还需要执行哪些 changeset。
 *
 * 严格只读：账本不存在时视为一条都没跑过，也不会建表。
 */
export function planChangesets(db: DatabaseSync, files: readonly ChangeLogFile[]): ChangesetPlan {
  const all = parseChangeLog(files);
  const known = new Map<string, number>();
  all.forEach((item, index) => known.set(keyOf(item.author, item.id, item.filename), index));

  const applied = new Set<string>();
  let maxAppliedIndex = -1;
  for (const row of readLedger(db)) {
    const key = keyOf(row.author, row.id, row.filename);
    const index = known.get(key);
    if (index === undefined) {
      console.warn(`[changeset] 账本里的「${row.filename} / ${row.author}:${row.id}」不在当前代码中，可能来自更新版本的应用`);
      continue;
    }
    if (row.exectype === 'executed') {
      applied.add(key);
      maxAppliedIndex = Math.max(maxAppliedIndex, index);
    }
  }

  const pending: ParsedChangeset[] = [];
  all.forEach((item, index) => {
    if (applied.has(keyOf(item.author, item.id, item.filename))) {
      return;
    }
    if (index < maxAppliedIndex) {
      console.warn(`[changeset]「${item.filename} / ${item.author}:${item.id}」排在已执行的 changeset 之前，只应往后追加`);
    }
    pending.push(item);
  });
  return { pending };
}

// ------------------------------------------------------------
// 备份
// ------------------------------------------------------------

/** 备份文件名里的时间戳 */
function backupStamp(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

/** 只保留最近若干份备份 */
async function pruneBackups(backupsDir: string): Promise<void> {
  const names = (await readdir(backupsDir))
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.db'))
    .sort();
  for (const name of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    await unlink(join(backupsDir, name));
  }
}

/**
 * 升级前复制一份数据库。
 *
 * 复制前先做一次 checkpoint，把 WAL 里的改动落回主文件，否则复制出来的可能缺最近几次事务。
 */
async function backupDatabase(db: DatabaseSync, dbPath: string, backupsDir: string): Promise<string> {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await mkdir(backupsDir, { recursive: true });
  const target = join(backupsDir, `${BACKUP_PREFIX}${backupStamp(new Date())}.db`);
  await copyFile(dbPath, target);
  await pruneBackups(backupsDir);
  return target;
}

// ------------------------------------------------------------
// 执行
// ------------------------------------------------------------

/** 把抛出物转成可读文本 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 组装一条进度 */
function makeProgress(
  status: MigrationProgress['status'],
  total: number,
  done: number,
  currentTitle: string,
  error: string,
  backupPath: string,
): MigrationProgress {
  return {
    status,
    total,
    done,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    currentTitle,
    error,
    backupPath,
  };
}

/**
 * 依次执行待处理的 changeset。
 *
 * 每个 changeset 一个事务：先执行、再记账、最后提交；失败即回滚并记一行 failed。
 * 之前成功的那些保留下来，下次启动从这一条接着来。changeset 的 SQL 自身不应再写
 * BEGIN / COMMIT，那会把这里的事务拆开。
 */
export async function runChangesets(options: RunOptions): Promise<MigrationOutcome> {
  const { db, dbPath, backupsDir, files, onProgress, shouldAbort } = options;
  db.exec(LEDGER_DDL);

  const { pending } = planChangesets(db, files);
  const total = pending.length;
  if (total === 0) {
    // 没有待执行的也要给一个终态：加载页靠它决定什么时候切回主界面
    onProgress?.(makeProgress('succeeded', 0, 0, '', '', ''));
    return { ok: true, aborted: false, applied: 0, error: '', backupPath: '' };
  }

  // 备份要复制整个库，可能要几百毫秒；先把加载页点起来，别让它空着等
  onProgress?.(makeProgress('running', total, 0, '正在备份数据库', '', ''));

  let backupPath = '';
  try {
    backupPath = await backupDatabase(db, dbPath, backupsDir);
  } catch (error) {
    const text = `升级前备份失败，已中止升级：${describeError(error)}`;
    onProgress?.(makeProgress('failed', total, 0, pending[0].title, text, ''));
    return { ok: false, aborted: false, applied: 0, error: text, backupPath: '' };
  }

  let order = nextOrder(db);
  let done = 0;
  for (const changeset of pending) {
    if (shouldAbort?.()) {
      return { ok: false, aborted: true, applied: done, error: '', backupPath };
    }
    onProgress?.(makeProgress('running', total, done, changeset.title, '', backupPath));

    const startedAt = Date.now();
    db.exec('BEGIN');
    try {
      db.exec(changeset.sql);
      writeLedger(db, changeset, 'executed', order, Date.now() - startedAt);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      order += 1;
      const message = describeError(error);
      writeLedger(db, changeset, 'failed', order, Date.now() - startedAt);
      const text = `${changeset.filename} / ${changeset.author}:${changeset.id}（${changeset.title}）执行失败：${message}`;
      onProgress?.(makeProgress('failed', total, done, changeset.title, text, backupPath));
      return { ok: false, aborted: false, applied: done, error: text, backupPath };
    }

    order += 1;
    done += 1;
    onProgress?.(makeProgress('running', total, done, changeset.title, '', backupPath));

    // 让出一次事件循环，迁移页才有机会把进度画出来
    await new Promise((resolve) => setImmediate(resolve));
  }

  onProgress?.(makeProgress('succeeded', total, done, pending[total - 1].title, '', backupPath));
  return { ok: true, aborted: false, applied: done, error: '', backupPath };
}
