// ============================================================
// 升级引擎
//
// 把版本清单展平成一条动作序列：每一版依次跑 preups → dbups 里的 changeSet → postups。
// 每一步单独一个事务、单独记一条账本；失败则回滚该步、记一行 failed 并中止整轮，
// 之前成功的都留下，下次启动从这一条接着来。
//
// 这里只依赖 Node 内置与第三方解析器：数据库能力由调用方以 MigrationStore 注入
// （见 database/db.ts），所以引擎可以在纯 Node 下用内存库验证，完全不认识 electron。
// ============================================================

import { copyFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';

import { DOMParser, type Element } from '@xmldom/xmldom';

import type { MigrationLedgerEntry, MigrationLedgerRow } from '@/database/db';

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

/** 脚本步骤在账本里的 author：脚本没有作者属性，写死才能保证同一动作换人也不重跑 */
const SCRIPT_AUTHOR = 'script';

/** 备份保留份数；开发库单份就有 100 MB 量级，留 3 份足够回退 */
const BACKUP_KEEP = 3;

/** 备份文件名前缀 */
const BACKUP_PREFIX = 'pre-migration-';

/** 脚本生命周期的中文名：写进账本 title，也显示在升级页上 */
const PHASE_TITLES: Record<ScriptPhase, string> = {
  preups: '预升级脚本',
  postups: '升级后脚本',
};

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

/** 脚本生命周期 */
type ScriptPhase = 'preups' | 'postups';

/** 一个步骤的三种来源 */
export type ChangePhase = ScriptPhase | 'dbups';

/** 升级脚本拿到的上下文 */
export interface ChangeScriptContext {
  /** 用户数据目录：脚本要往数据目录里落文件就用它 */
  dataDir: string;
}

/** 一段升级脚本：普通模块导出的函数，同步异步都行，由引擎 await */
export type ChangeScript = (ctx: ChangeScriptContext) => void | Promise<void>;

/**
 * 一个版本目录的内容。
 *
 * 三段都可以缺：只写 preups 的版本目录是合法的。version 必须写死在目录的 index.ts 里，
 * 与目录名无关——目录改名不会改变账本身份。
 */
export interface ChangeLogVersion {
  version: string;
  dbups?: string;
  preups?: ChangeScript;
  postups?: ChangeScript;
}

/** database 模块交给升级模块的全部能力 */
export interface MigrationStore {
  getDataDir(): string;
  getDbPath(): string;
  execSql(sql: string): void;
  runInMigrationTransaction<T>(fn: () => T | Promise<T>): Promise<T>;
  readMigrationLedger(): MigrationLedgerRow[];
  writeMigrationLedger(entry: MigrationLedgerEntry): void;
}

/** 解析出来的一条 changeSet */
interface ParsedChangeSet {
  author: string;
  id: string;
  filename: string;
  title: string;
  sql: string;
}

/** 展平后的一步动作：sql 与 run 二选一 */
interface ChangeStep {
  phase: ChangePhase;
  /** 版本号，同时是账本里的 filename */
  filename: string;
  author: string;
  id: string;
  title: string;
  sql?: string;
  run?: ChangeScript;
}

/**
 * 一轮升级的进度。
 *
 * 只给升级自己用：加载页看的是加载服务的 LoadProgress，两者的转换在 ups/index.ts。
 */
export interface MigrationProgress {
  status: 'running' | 'succeeded' | 'failed';
  /** 待执行的步骤总数 */
  total: number;
  /** 已完成的条数 */
  done: number;
  /** 整体百分比，0-100 */
  percent: number;
  /** 当前（或最后一条）步骤的标题 */
  currentTitle: string;
  /** 失败原因；成功时为空串 */
  error: string;
  /** 升级前的备份路径；没有产生备份时为空串 */
  backupPath: string;
}

/** 一次升级的结果 */
export interface MigrationOutcome {
  ok: boolean;
  /** 主窗口已被关闭，升级主动收手 */
  aborted: boolean;
  applied: number;
  error: string;
  backupPath: string;
}

/** 执行一次升级所需的全部外部输入 */
export interface RunOptions {
  store: MigrationStore;
  /** 版本清单，顺序即执行顺序 */
  versions: readonly ChangeLogVersion[];
  onProgress?: (progress: MigrationProgress) => void;
  /** 主窗口已经关掉时收手 */
  shouldAbort?: () => boolean;
}

// ------------------------------------------------------------
// 解析与计划
// ------------------------------------------------------------

/** 身份键：账本按 (author, id, filename) 三元组记账 */
function keyOf(author: string, id: string, filename: string): string {
  return `${author}|${id}|${filename}`;
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

/** 解析一版的 dbups.xml；没有这个文件就没有 SQL 步骤 */
function parseChangeSets(version: ChangeLogVersion): ParsedChangeSet[] {
  if (version.dbups === undefined) {
    return [];
  }

  const parser = new DOMParser({
    // 不接这个回调，解析器只记一条日志就继续，返回的可能是半个文档
    onError: (_level, message) => {
      throw new Error(`changelog「${version.version}」解析失败：${message}`);
    },
  });
  const doc = parser.parseFromString(version.dbups, 'text/xml');
  const nodes = doc.getElementsByTagName('changeSet');
  const result: ParsedChangeSet[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes.item(i);
    if (!node) {
      continue;
    }
    const author = node.getAttribute('author') ?? '';
    const id = node.getAttribute('id') ?? '';
    if (author === '' || id === '') {
      throw new Error(`changelog「${version.version}」里有 changeSet 缺少 id 或 author`);
    }
    const sql = readSql(node);
    if (sql === '') {
      throw new Error(`changelog「${version.version}」的 changeset ${author}:${id} 里没有可执行的 <sql>`);
    }
    result.push({ author, id, filename: version.version, title: readTitle(node, author, id), sql });
  }
  return result;
}

/** 把版本清单按「preups → dbups → postups」展平成动作序列 */
function buildSteps(versions: readonly ChangeLogVersion[]): ChangeStep[] {
  const seen = new Set<string>();
  const steps: ChangeStep[] = [];

  for (const version of versions) {
    if (seen.has(version.version)) {
      // 复制版本目录时忘了改 VERSION：新版本的 changeSet 会顶用旧版本的身份，
      // 被账本判定为已执行而静默跳过——宁可启动就失败
      throw new Error(`版本清单里的版本号重复：${version.version}（检查各版本目录 index.ts 里的 VERSION）`);
    }
    seen.add(version.version);

    if (version.preups) {
      steps.push({
        phase: 'preups',
        filename: version.version,
        author: SCRIPT_AUTHOR,
        id: 'preups',
        title: PHASE_TITLES.preups,
        run: version.preups,
      });
    }

    for (const set of parseChangeSets(version)) {
      steps.push({ phase: 'dbups', ...set });
    }

    if (version.postups) {
      steps.push({
        phase: 'postups',
        filename: version.version,
        author: SCRIPT_AUTHOR,
        id: 'postups',
        title: PHASE_TITLES.postups,
        run: version.postups,
      });
    }
  }

  return steps;
}

/**
 * 算出还需要执行哪些步骤。
 *
 * 「跑过没有」按身份判断：账本里有这个三元组就是跑过，失败行不算。
 */
function planSteps(ledger: readonly MigrationLedgerRow[], versions: readonly ChangeLogVersion[]): ChangeStep[] {
  const all = buildSteps(versions);
  const known = new Map<string, number>();
  all.forEach((step, index) => {
    const key = keyOf(step.author, step.id, step.filename);
    if (!known.has(key)) {
      known.set(key, index);
    }
  });

  const applied = new Set<string>();
  let maxAppliedIndex = -1;
  for (const row of ledger) {
    const key = keyOf(row.author, row.id, row.filename);
    const index = known.get(key);
    if (index === undefined) {
      console.warn(`[ups] 账本里的「${row.filename} / ${row.author}:${row.id}」不在当前代码中，可能来自更新版本的应用`);
      continue;
    }
    if (row.exectype === 'executed') {
      applied.add(key);
      maxAppliedIndex = Math.max(maxAppliedIndex, index);
    }
  }

  const pending: ChangeStep[] = [];
  all.forEach((step, index) => {
    if (applied.has(keyOf(step.author, step.id, step.filename))) {
      return;
    }
    if (index < maxAppliedIndex) {
      console.warn(`[ups]「${step.filename} / ${step.author}:${step.id}」排在已执行的步骤之前，只应往后追加`);
    }
    pending.push(step);
  });
  return pending;
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

/**
 * 只保留最近若干份备份。
 *
 * 每次启动都跑（见 runUps）：只在「真的备份了」的时候清，不升级的库会一直堆着旧备份。
 */
async function pruneBackups(backupsDir: string): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(backupsDir)).filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.db')).sort();
  } catch {
    // 目录还不存在：第一次启动就是这样
    return;
  }
  for (const name of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    try {
      await unlink(join(backupsDir, name));
      console.log(`[ups] 清理旧备份：${name}`);
    } catch (error) {
      console.error(`[ups] 删除旧备份失败：${name}`, error);
    }
  }
}

/**
 * 升级前复制一份数据库。
 *
 * 复制前先做一次 checkpoint，把 WAL 里的改动落回主文件，否则复制出来的可能缺最近几次事务。
 */
async function backupDatabase(store: MigrationStore, backupsDir: string): Promise<string> {
  store.execSql('PRAGMA wal_checkpoint(TRUNCATE)');
  await mkdir(backupsDir, { recursive: true });
  const target = join(backupsDir, `${BACKUP_PREFIX}${backupStamp(new Date())}.db`);
  await copyFile(store.getDbPath(), target);
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

/** 下一个执行序号 */
function nextOrder(ledger: readonly MigrationLedgerRow[]): number {
  return ledger.reduce((max, row) => Math.max(max, row.orderExecuted), 0) + 1;
}

/** 步骤在界面与账本里的显示名 */
function stepTitle(step: ChangeStep): string {
  return `${step.filename} ${step.title}`;
}

/**
 * 跑一轮升级。
 *
 * 顺序固定：先清理旧备份，再算待执行步骤，有待执行的才备份，然后逐步执行。
 * 每一步都在自己的事务里：脚本抛错时它写进数据库的东西随事务一起回滚，账本也不会记成已执行。
 */
export async function runUps(options: RunOptions): Promise<MigrationOutcome> {
  const { store, versions, onProgress, shouldAbort } = options;
  const backupsDir = join(store.getDataDir(), 'backups');

  store.execSql(LEDGER_DDL);
  await pruneBackups(backupsDir);

  const pending = planSteps(store.readMigrationLedger(), versions);
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
    backupPath = await backupDatabase(store, backupsDir);
  } catch (error) {
    const text = `升级前备份失败，已中止升级：${describeError(error)}`;
    onProgress?.(makeProgress('failed', total, 0, stepTitle(pending[0]), text, ''));
    return { ok: false, aborted: false, applied: 0, error: text, backupPath: '' };
  }

  let order = nextOrder(store.readMigrationLedger());
  let done = 0;
  for (const step of pending) {
    if (shouldAbort?.()) {
      return { ok: false, aborted: true, applied: done, error: '', backupPath };
    }
    onProgress?.(makeProgress('running', total, done, stepTitle(step), '', backupPath));

    const startedAt = Date.now();
    try {
      await store.runInMigrationTransaction(async () => {
        if (step.sql !== undefined) {
          store.execSql(step.sql);
        }
        if (step.run !== undefined) {
          await step.run({ dataDir: store.getDataDir() });
        }
        store.writeMigrationLedger({
          author: step.author,
          id: step.id,
          filename: step.filename,
          title: step.title,
          exectype: 'executed',
          order,
          executionMs: Date.now() - startedAt,
        });
      });
    } catch (error) {
      // 事务已经回滚：脚本写进库的东西一条都不留，这里只补一行失败记录供排查
      const message = describeError(error);
      store.writeMigrationLedger({
        author: step.author,
        id: step.id,
        filename: step.filename,
        title: step.title,
        exectype: 'failed',
        order,
        executionMs: Date.now() - startedAt,
      });
      const text = `${step.filename} / ${step.author}:${step.id}（${step.title}）执行失败：${message}`;
      onProgress?.(makeProgress('failed', total, done, stepTitle(step), text, backupPath));
      return { ok: false, aborted: false, applied: done, error: text, backupPath };
    }

    order += 1;
    done += 1;
    onProgress?.(makeProgress('running', total, done, stepTitle(step), '', backupPath));

    // 让出一次事件循环，迁移页才有机会把进度画出来
    await new Promise((resolve) => setImmediate(resolve));
  }

  onProgress?.(makeProgress('succeeded', total, done, stepTitle(pending[total - 1]), '', backupPath));
  return { ok: true, aborted: false, applied: done, error: '', backupPath };
}
