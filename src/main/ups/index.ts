import {
  execSql, getDbPath, readMigrationLedger, runInMigrationTransaction, writeMigrationLedger,
} from '@/database/db';
import type { LoadTaskReport } from '@/loading';
import { createLogger } from '@/log';
import { getDataDir } from '@/paths';
import { CHANGELOG_VERSIONS } from '@/ups/changesets';
import { runUps } from '@/ups/engine';
import { get } from '@/window-manager';

/** 本模块的日志（category `main.ups`） */
const log = createLogger('ups');

/**
 * 升级任务：登记给加载服务的一步（见 docs/design/loading.md）。
 *
 * 成败不再靠返回值表达：失败时把备份路径放进附注再抛出，由加载服务公布终态、让加载页停在错误上。
 * 主窗口被关掉时升级主动收手，那不算失败——应用本来就要退出了。
 */
export async function initUps(report: LoadTaskReport): Promise<void> {
  const outcome = await runUps({
    store: {
      getDataDir,
      getDbPath,
      execSql,
      runInMigrationTransaction,
      readMigrationLedger,
      writeMigrationLedger,
    },
    versions: CHANGELOG_VERSIONS,
    log,
    onProgress: (progress) => {
      // 升级自己的终态不转发：切主界面还是停在这一页，由加载服务在所有必须任务之后统一公布
      if (progress.status !== 'running') {
        return;
      }
      report({
        step: progress.currentTitle,
        done: progress.done,
        total: progress.total,
        percent: progress.percent,
      });
    },
    // 主窗口被关掉就不必再升级了：关窗即退出应用
    shouldAbort: () => !get('main'),
  });

  if (outcome.ok || outcome.aborted) {
    return;
  }
  if (outcome.backupPath !== '') {
    report({ note: `升级前的备份：${outcome.backupPath}` });
  }
  throw new Error(outcome.error);
}
