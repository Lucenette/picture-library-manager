import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MigrationLedgerEntry, MigrationLedgerRow } from '@/database/db';
import type { MigrationStore } from '@/ups/engine';

/**
 * 升级引擎的假 store：账本与已执行的 SQL 都在内存里，事务用整份快照模拟回滚。
 *
 * 数据库文件是临时目录里的一个占位文件——备份那一步会真的去复制它。
 */
export class MemoryStore implements MigrationStore {
  readonly ledger: MigrationLedgerRow[] = [];
  /** 事务外可见的 SQL；事务里写了又抛错的会被快照回滚掉 */
  readonly committedSql: string[] = [];
  private readonly dataDir: string;
  private readonly dbPath: string;

  constructor() {
    this.dataDir = mkdtempSync(join(tmpdir(), 'plm-ups-'));
    this.dbPath = join(this.dataDir, 'picture-lib.db');
    writeFileSync(this.dbPath, 'fake database');
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  execSql(sql: string): void {
    this.committedSql.push(sql);
  }

  async runInMigrationTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const ledger = this.ledger.slice();
    const sql = this.committedSql.slice();
    try {
      return await fn();
    } catch (error) {
      this.ledger.length = 0;
      this.ledger.push(...ledger);
      this.committedSql.length = 0;
      this.committedSql.push(...sql);
      throw error;
    }
  }

  readMigrationLedger(): MigrationLedgerRow[] {
    return this.ledger.map((row) => ({ ...row }));
  }

  writeMigrationLedger(entry: MigrationLedgerEntry): void {
    this.ledger.push({
      author: entry.author,
      id: entry.id,
      filename: entry.filename,
      exectype: entry.exectype,
      orderExecuted: entry.order,
    });
  }
}
