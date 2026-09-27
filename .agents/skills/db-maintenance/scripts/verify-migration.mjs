/**
 * 迁移预演：在临时库与库副本上跑 changeset，不碰真实库。
 *
 * 运行：node .agents/skills/db-maintenance/scripts/verify-migration.mjs
 * 依赖 node:sqlite（Node 22+ 内置）与 @xmldom/xmldom（本仓库的显式依赖）。
 *
 * 只重放各版本目录里的 dbups.xml：preups.ts / postups.ts 是编译进主进程包的 TS，
 * 没法在纯 Node 里跑，所以脚本会打印哪些版本带脚本、需要另外在库副本上手工冒烟。
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { DOMParser } from '@xmldom/xmldom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DIR = join(ROOT, 'src/main/ups/changesets');
const DEV_DB = join(ROOT, 'dist/data/picture-lib.db');
const LEDGER = 'schema_migration';
/** 约定文件里除了 dbups.xml 之外的两段脚本，只用来提示「没被预演」 */
const SCRIPT_FILES = ['preups.ts', 'postups.ts'];

/** 版本号写死在目录的 index.ts 里（与目录名无关），预演也要用它 */
function readDeclaredVersion(absDir) {
  const indexPath = join(absDir, 'index.ts');
  if (!existsSync(indexPath)) {
    return null;
  }
  const match = /VERSION\s*=\s*'([^']+)'/.exec(readFileSync(indexPath, 'utf8'));
  return match ? match[1] : null;
}

/** 解析一份 dbups.xml；账本里的 filename 取版本号 */
function parseChangesets(version, source) {
  const errors = [];
  const doc = new DOMParser({
    onError: (level, message) => {
      errors.push(level + ': ' + message);
    },
  }).parseFromString(source, 'text/xml');
  if (errors.length > 0) {
    console.log('  ' + version + '/dbups.xml 解析报错：' + errors.join(' | '));
  }
  const sets = [];
  for (const set of Array.from(doc.getElementsByTagName('changeSet'))) {
    const comment = set.getElementsByTagName('comment')[0];
    const sqlNode = set.getElementsByTagName('sql')[0];
    sets.push({
      filename: version,
      author: set.getAttribute('author'),
      id: set.getAttribute('id'),
      title: comment ? comment.textContent.trim() : '',
      sql: sqlNode ? sqlNode.textContent.trim() : '',
    });
  }
  return sets;
}

/** 读全部版本目录：按目录名排序（与版本号递增一致） */
function readVersions() {
  const names = readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return names.map((name) => {
    const absDir = join(DIR, name);
    const declared = readDeclaredVersion(absDir);
    const xmlPath = join(absDir, 'dbups.xml');
    return {
      version: declared ?? name,
      dirName: name,
      declared: declared !== null,
      dbups: existsSync(xmlPath) ? readFileSync(xmlPath, 'utf8') : null,
      scripts: SCRIPT_FILES.filter((file) => existsSync(join(absDir, file))),
    };
  });
}

/** 结构与行数的快照，用于比对两条路径的结果 */
function snapshot(db) {
  // 账本由代码创建，不在 changelog 里，比对时排除掉
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => row.name).filter((name) => name !== LEDGER);
  const columns = new Map();
  const rows = new Map();
  for (const table of tables) {
    // 只比列集合：老库上后来用 ALTER TABLE ADD COLUMN 补的列会排在最后，与全新库的书写顺序不同
    columns.set(table, db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name).sort().join(','));
    rows.set(table, db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
  }
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => row.name);
  return { tables, columns, rows, indexes };
}

function execPending(db, sets) {
  for (const set of sets) {
    db.exec('BEGIN');
    try {
      db.exec(set.sql);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.log('  执行失败：' + set.filename + ' / ' + set.author + ':' + set.id + '（' + set.title + '）');
      throw error;
    }
  }
}

const versions = readVersions();
const sets = [];
for (const version of versions) {
  if (version.dbups !== null) {
    sets.push(...parseChangesets(version.version, version.dbups));
  }
}
console.log('版本目录：' + versions.length + ' 个，dbups 里的 changeset 合计 ' + sets.length + ' 条');
const skipped = [];
for (const version of versions) {
  const files = [version.dbups !== null ? 'dbups.xml' : null, ...version.scripts].filter(Boolean);
  console.log('  ' + version.version + '（' + version.dirName + '）：' + (files.length > 0 ? files.join(' + ') : '空目录'));
  if (!version.declared) {
    console.log('    index.ts 里没读到 VERSION 常量，按目录名当版本号');
  }
  if (version.version !== version.dirName) {
    console.log('    目录名与代码里的版本号不一致；账本身份以代码里的为准');
  }
  if (version.scripts.length > 0) {
    skipped.push(version.version + ' 的 ' + version.scripts.join(' / '));
  }
}
if (skipped.length > 0) {
  console.log('');
  console.log('下面这些升级脚本不在预演范围内（TS，必须编译进主进程包才能跑），请在库副本上手工冒烟：');
  for (const item of skipped) {
    console.log('  ' + item);
  }
}

// 路径一：全新库，按顺序跑完
const fresh = join(ROOT, 'dist/data/_verify-fresh.db');
if (existsSync(fresh)) {
  rmSync(fresh);
}
const freshDb = new DatabaseSync(fresh);
execPending(freshDb, sets);
const freshState = snapshot(freshDb);
freshDb.close();
rmSync(fresh);
console.log('');
console.log('【全新库】');
console.log('  表：' + freshState.tables.join(', '));
console.log('  索引：' + freshState.indexes.join(', '));

// 路径二：现有库副本，只跑账本里没记过的
if (!existsSync(DEV_DB)) {
  console.log('');
  console.log('【现有库】跳过：没有 ' + DEV_DB);
} else {
  const copy = join(ROOT, 'dist/data/_verify-existing.db');
  copyFileSync(DEV_DB, copy);
  if (existsSync(DEV_DB + '-wal')) {
    copyFileSync(DEV_DB + '-wal', copy + '-wal');
  }
  const copyDb = new DatabaseSync(copy);
  const before = snapshot(copyDb);
  const ledgerExists = copyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(LEDGER) !== undefined;
  const executed = new Set();
  if (ledgerExists) {
    for (const row of copyDb.prepare('SELECT author, id, filename FROM ' + LEDGER).all()) {
      executed.add(row.author + ':' + row.id + ':' + row.filename);
    }
  }
  const pending = sets.filter((set) => !executed.has(set.author + ':' + set.id + ':' + set.filename));
  console.log('');
  console.log('【现有库】账本已记 ' + executed.size + ' 条，待执行 ' + pending.length + ' 条');
  if (pending.length > 0) {
    execPending(copyDb, pending);
  }
  const after = snapshot(copyDb);
  copyDb.close();
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(copy + suffix)) {
      rmSync(copy + suffix);
    }
  }
  const changed = [];
  for (const table of after.tables) {
    const beforeRows = before.rows.get(table);
    const afterRows = after.rows.get(table);
    if (beforeRows !== undefined && beforeRows !== afterRows) {
      changed.push(table + ' ' + beforeRows + ' → ' + afterRows);
    }
    const beforeCols = before.columns.get(table);
    const afterCols = after.columns.get(table);
    if (beforeCols !== undefined && beforeCols !== afterCols) {
      changed.push(table + ' 列变化：' + beforeCols + ' → ' + afterCols);
    }
  }
  console.log('  行数与列变化：' + (changed.length === 0 ? '无' : changed.join('；')));
  console.log('  表：' + after.tables.join(', '));
  const same = JSON.stringify(freshState.tables) === JSON.stringify(after.tables)
    && JSON.stringify([...freshState.columns].sort()) === JSON.stringify([...after.columns].sort())
    && JSON.stringify(freshState.indexes) === JSON.stringify(after.indexes);
  console.log('  与全新库结构一致：' + (same ? '是' : '否（两条路径没有收敛，检查是否改写了已执行过的 CREATE）'));
}
