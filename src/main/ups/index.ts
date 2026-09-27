import {
  execSql, getDbPath, readMigrationLedger, runInMigrationTransaction, writeMigrationLedger,
} from '@/database/db';
import { getDataDir } from '@/paths';
import { CHANGELOG_VERSIONS } from '@/ups/changesets';
import type { MigrationOutcome } from '@/ups/engine';
import { runUps } from '@/ups/engine';
import { initUpsIpc, sendUpsProgress } from '@/ups/progress';
import { get } from '@/window-manager';

/** 失败页要等用户点「退出」；启动流程用它决定什么时候 app.quit() */
export { waitUpsQuit } from '@/ups/progress';

/**
 * 初始化升级模块并执行本轮升级。
 *
 * 启动流程只调这一个函数：升级页的通道注册与升级本身都归它，数据库那边只提供被调用的能力
 * （见 database/db.ts 暴露的那几个函数）。返回结果供启动流程决定失败后是否等用户点「退出」。
 */
export async function initUps(): Promise<MigrationOutcome> {
  initUpsIpc();

  return runUps({
    store: {
      getDataDir,
      getDbPath,
      execSql,
      runInMigrationTransaction,
      readMigrationLedger,
      writeMigrationLedger,
    },
    versions: CHANGELOG_VERSIONS,
    onProgress: sendUpsProgress,
    // 主窗口被关掉就不必再升级了：关窗即退出应用
    shouldAbort: () => !get('main'),
  });
}
