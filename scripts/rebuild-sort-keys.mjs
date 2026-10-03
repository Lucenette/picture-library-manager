/**
 * 排序键整表重建。
 *
 * 排序规则（`src/main/database/sort/`）变了以后，用它把库里的派生排序键全量重算并顺带对账：
 *   1. 现场编译 `sort/`（TypeScript 编译器 API，产物落在系统临时目录，不进仓库）；
 *   2. 打开库，逐表把原文重新算成键写回，统计有多少行的键真的变了；
 *   3. 收尾核对每张表都不留空键。
 *
 * 只改 `*_sort` 列，不动任何原文；跑之前请先关掉应用（同一个库文件不要两个进程一起写）。
 *
 * 用法：node scripts/rebuild-sort-keys.mjs [库文件]
 * 默认库文件是开发态的 `dist/data/picture-lib.db`；装好的应用在 `~/.plmanager/data/picture-lib.db`。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

const ROOT = resolve(import.meta.dirname, '..');
const SORT_DIR = join(ROOT, 'src/main/database/sort');
const DEFAULT_DB = join(ROOT, 'dist/data/picture-lib.db');

/** 编译 `sort/` 并把它加载进来；临时产物用完即删 */
function loadSortModule() {
  const ts = require('typescript');
  // 产物落在仓库的 dist/ 下：从那里往上找得到 node_modules，临时目录里解析不到 pinyin-pro
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  const outDir = mkdtempSync(join(ROOT, 'dist/sort-rebuild-'));
  const program = ts.createProgram([join(SORT_DIR, 'index.ts')], {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
    skipLibCheck: true,
    strict: true,
    outDir,
    rootDir: SORT_DIR,
  });

  try {
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      const text = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => ROOT,
        getNewLine: () => '\n',
      });
      throw new Error(`cannot compile ${SORT_DIR}:\n${text}`);
    }

    program.emit();
    return require(join(outDir, 'index.js'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** 库里的排序键列是不是都就位了；没有就说明还没跑 1.1.1 的升级 */
function missingColumns(db, tables) {
  const missing = [];
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table.table})`).all().map((column) => column.name);
    for (const field of table.fields) {
      if (!columns.includes(field.sortColumn)) {
        missing.push(`${table.table}.${field.sortColumn}`);
      }
    }
  }
  return missing;
}

/** 重算一张表，返回 { rows, changed } */
function rebuildTable(db, table, sortKeyOf) {
  const texts = table.fields.map((field) => field.textColumn);
  const sorts = table.fields.map((field) => field.sortColumn);
  const select = `SELECT id, ${texts.join(', ')}, ${sorts.join(', ')} FROM ${table.table}`;
  const update = `UPDATE ${table.table} SET ${sorts.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`;
  const rows = db.prepare(select).all();
  const statement = db.prepare(update);

  let changed = 0;
  for (const row of rows) {
    const keys = table.fields.map((field) => sortKeyOf(row[field.textColumn] === null ? '' : String(row[field.textColumn]), field.profile));
    if (keys.every((key, index) => key === row[sorts[index]])) {
      continue;
    }
    statement.run(...keys, row.id);
    changed += 1;
  }
  return { rows: rows.length, changed };
}

const dbPath = process.argv[2] === undefined ? DEFAULT_DB : resolve(process.argv[2]);
if (!existsSync(dbPath)) {
  console.error(`找不到库文件：${dbPath}`);
  process.exit(1);
}

const { SORT_KEY_TABLES, sortKeyOf } = loadSortModule();
const db = new DatabaseSync(dbPath);
const missing = missingColumns(db, SORT_KEY_TABLES);
if (missing.length > 0) {
  db.close();
  console.error(`库里还没有这些排序键列：${missing.join(', ')}`);
  console.error('先启动一次应用，让 1.1.1 的升级把列建出来，再跑这个脚本。');
  process.exit(1);
}

console.log(`重建排序键：${dbPath}`);
let total = 0;
let totalChanged = 0;
try {
  db.exec('BEGIN');
  for (const table of SORT_KEY_TABLES) {
    const startedAt = Date.now();
    const { rows, changed } = rebuildTable(db, table, sortKeyOf);
    total += rows;
    totalChanged += changed;
    console.log(`  ${table.table}: ${rows} 行，改动 ${changed} 行（${Date.now() - startedAt}ms）`);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  db.close();
  throw error;
}

let empty = 0;
for (const table of SORT_KEY_TABLES) {
  const condition = table.fields.map((field) => `${field.sortColumn} IS NULL`).join(' OR ');
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table.table} WHERE ${condition}`).get().n;
  if (count > 0) {
    empty += count;
    console.error(`  ${table.table}: 还有 ${count} 行没有键`);
  }
}
db.close();

console.log(`合计 ${total} 行，实际改动 ${totalChanged} 行`);
if (empty > 0) {
  console.error(`对账失败：${empty} 行的键为空`);
  process.exit(1);
}
console.log('对账通过：没有空键。');
