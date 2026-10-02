import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { runUps, type ChangeLogVersion, type MigrationProgress, type UpsLogger } from '@/ups/engine';

import { MemoryStore } from '@test/setup/memory-store';

const logger: UpsLogger = { error: () => {}, warn: () => {}, info: () => {} };

/** 拼一份 dbups.xml；sql 里出现 BOOM 时 ThrowingStore 会抛错 */
function xmlWith(sets: string): string {
  return '<databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">' + sets + '</databaseChangeLog>';
}

function changeSet(id: string, author: string, sql: string): string {
  return '<changeSet id="' + id + '" author="' + author + '"><comment>test</comment><sql>' + sql + '</sql></changeSet>';
}

class ThrowingStore extends MemoryStore {
  execSql(sql: string): void {
    super.execSql(sql);
    if (sql.includes('BOOM')) {
      throw new Error('boom');
    }
  }
}

test('按 preups → dbups → postups 三步执行', async () => {
  const store = new MemoryStore();
  const versions: ChangeLogVersion[] = [
    {
      version: '1.0.0',
      preups: () => {},
      dbups: xmlWith(changeSet('1', 'tester', 'CREATE TABLE t (id INTEGER)')),
      postups: () => {},
    },
  ];
  const outcome = await runUps({ store, versions, log: logger });
  expect(outcome.ok).toBe(true);
  expect(store.ledger.map((row) => row.author + ':' + row.id)).toEqual([
    'script:preups',
    'tester:1',
    'script:postups',
  ]);
});

test('已执行的步骤不再重跑', async () => {
  const store = new MemoryStore();
  let preupsRuns = 0;
  const versions: ChangeLogVersion[] = [
    {
      version: '1.0.0',
      preups: () => {
        preupsRuns += 1;
      },
      dbups: xmlWith(changeSet('1', 'tester', 'CREATE TABLE t (id INTEGER)')),
    },
  ];
  const first = await runUps({ store, versions, log: logger });
  expect(first.applied).toBe(2);
  const second = await runUps({ store, versions, log: logger });
  expect(second.applied).toBe(0);
  expect(preupsRuns).toBe(1);
});

test('账本里的 failed 行不算已执行', async () => {
  const store = new MemoryStore();
  store.ledger.push({ author: 'script', id: 'preups', filename: '1.0.0', exectype: 'failed', orderExecuted: 1 });
  let ran = 0;
  const versions: ChangeLogVersion[] = [
    {
      version: '1.0.0',
      preups: () => {
        ran += 1;
      },
    },
  ];
  const outcome = await runUps({ store, versions, log: logger });
  expect(ran).toBe(1);
  expect(outcome.applied).toBe(1);
});

test('脚本抛错时事务回滚、只记 failed、中止整轮', async () => {
  const store = new ThrowingStore();
  let later = 0;
  const versions: ChangeLogVersion[] = [
    {
      version: '1.0.0',
      dbups: xmlWith(
        changeSet('1', 'tester', 'CREATE TABLE a (id INTEGER)')
        + changeSet('2', 'tester', 'BOOM'),
      ),
    },
    {
      version: '1.0.1',
      postups: () => {
        later += 1;
      },
    },
  ];
  const outcome = await runUps({ store, versions, log: logger });
  expect(outcome.ok).toBe(false);
  expect(outcome.applied).toBe(1);
  expect(store.committedSql.some((sql) => sql.includes('BOOM'))).toBe(false);
  expect(store.ledger.filter((row) => row.exectype === 'executed')).toHaveLength(1);
  const failed = store.ledger.filter((row) => row.exectype === 'failed');
  expect(failed).toHaveLength(1);
  expect(failed[0].id).toBe('2');
  expect(later).toBe(0);
});

test('清单里出现重复版本号直接抛错', async () => {
  const store = new MemoryStore();
  const versions: ChangeLogVersion[] = [{ version: '1.0.0' }, { version: '1.0.0' }];
  await expect(runUps({ store, versions, log: logger })).rejects.toThrow(/duplicate version/);
});

test('changeSet 缺 id 或 author 直接抛错', async () => {
  const store = new MemoryStore();
  const versions: ChangeLogVersion[] = [
    { version: '1.0.0', dbups: xmlWith('<changeSet><sql>CREATE TABLE t (id INTEGER)</sql></changeSet>') },
  ];
  await expect(runUps({ store, versions, log: logger })).rejects.toThrow(/without id or author/);
});

test('changeSet 没有 sql 直接抛错', async () => {
  const store = new MemoryStore();
  const versions: ChangeLogVersion[] = [
    { version: '1.0.0', dbups: xmlWith('<changeSet id="1" author="tester"><comment>x</comment></changeSet>') },
  ];
  await expect(runUps({ store, versions, log: logger })).rejects.toThrow(/no executable/);
});

test('没有待执行步骤时给成功终态', async () => {
  const store = new MemoryStore();
  const progress: MigrationProgress[] = [];
  const outcome = await runUps({
    store,
    versions: [],
    log: logger,
    onProgress: (item) => {
      progress.push(item);
    },
  });
  expect(outcome.ok).toBe(true);
  expect(outcome.applied).toBe(0);
  expect(progress.at(-1)?.status).toBe('succeeded');
  expect(progress.at(-1)?.total).toBe(0);
});

test('备份只保留最近 3 份', async () => {
  const store = new MemoryStore();
  const backupsDir = join(store.getDataDir(), 'backups');
  mkdirSync(backupsDir, { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    writeFileSync(join(backupsDir, 'pre-migration-20260101-0000' + i + '.db'), 'x');
  }
  await runUps({ store, versions: [], log: logger });
  const left = readdirSync(backupsDir).filter((name) => name.startsWith('pre-migration-'));
  expect(left).toHaveLength(3);
});

test('shouldAbort 为真时立刻收手', async () => {
  const store = new MemoryStore();
  const versions: ChangeLogVersion[] = [
    { version: '1.0.0', dbups: xmlWith(changeSet('1', 'tester', 'CREATE TABLE t (id INTEGER)')) },
  ];
  const outcome = await runUps({ store, versions, log: logger, shouldAbort: () => true });
  expect(outcome.aborted).toBe(true);
  expect(outcome.applied).toBe(0);
});
