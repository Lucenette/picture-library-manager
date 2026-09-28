import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import type { ExportTaskPayload, ExportTaskResult } from '@common/types';
import { getProcessedForExport, type ProcessedExportRow } from '@/database/db';
import { createLogger } from '@/log';
import type { TaskContext } from '@/task/manager';

/** 本模块的日志（category `main.export`） */
const log = createLogger('export');

/**
 * 把一批图库记录导出到目标目录。
 *
 * 目录结构为 {目标目录}/{角色名}/{角色名}_{0001}.{扩展名}，序号按角色在本轮
 * 导出中的出现顺序递增；失败的文件逐条记录，不中断整轮导出。
 */
export async function runExport(ctx: TaskContext): Promise<ExportTaskResult> {
  const { imageIds, targetDir } = ctx.payload as ExportTaskPayload;
  const rows = getProcessedForExport(imageIds);
  const total = rows.length;

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const counters = new Map<string, number>();
  let copied = 0;
  let failed = 0;

  for (const [index, row] of rows.entries()) {
    try {
      copyImage(row, targetDir, counters);
      copied += 1;
    } catch (error) {
      failed += 1;
      log.error(`export failed [${row.selectedFile}]`, error);
    }

    ctx.report(((index + 1) / Math.max(total, 1)) * 100, `已导出 ${index + 1}/${total}`);
    await ctx.checkpoint();
  }

  log.info(`export finished: ${copied} copied, ${failed} failed`);
  return { copied, failed };
}

/** 按「角色名 / 角色名_序号.扩展名」复制一张图片 */
function copyImage(row: ProcessedExportRow, targetDir: string, counters: Map<string, number>): void {
  const sequence = (counters.get(row.characterName) ?? 0) + 1;
  counters.set(row.characterName, sequence);

  const characterDir = join(targetDir, row.characterName);
  mkdirSync(characterDir, { recursive: true });

  const fileName = `${row.characterName}_${String(sequence).padStart(4, '0')}${extname(row.selectedFile)}`;
  copyFileSync(row.selectedFile, join(characterDir, fileName));
}
