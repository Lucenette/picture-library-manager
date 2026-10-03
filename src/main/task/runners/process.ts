import { randomUUID } from 'crypto';

import type { ImageGroupView, ProcessTaskPayload, ProcessTaskResult } from '@common/types';

import {
  beginBatch, endBatch, getImageFilesByGroup, getImageGroupsViewByIds, upsertProcessedImage,
} from '@/database/db';
import { createLogger } from '@/log';
import { executeScript } from '@/script/script-service';
import type { TaskContext } from '@/task/manager';

/** 本模块的日志（category `main.process`） */
const log = createLogger('process');

/**
 * 对一批图片组执行选图脚本。
 *
 * 单组失败只累加计数不影响其它组；已完成的组在取消时保留。
 */
export async function runProcess(ctx: TaskContext): Promise<ProcessTaskResult> {
  const { groupIds, scriptId } = ctx.payload as ProcessTaskPayload;
  const groups = getImageGroupsViewByIds(groupIds);
  const total = groups.length;

  let processed = 0;
  let failed = 0;

  beginBatch();
  try {
    for (const [index, group] of groups.entries()) {
      try {
        await selectImageForGroup(group, scriptId);
        processed += 1;
      } catch (error) {
        failed += 1;
        log.error(`process group failed: ${group.dirPath}`, error);
      }

      ctx.report(((index + 1) / Math.max(total, 1)) * 100, `已处理 ${index + 1}/${total}`);
      await ctx.checkpoint();
    }
  } finally {
    endBatch();
  }

  log.info(`process finished: ${processed} groups processed, ${failed} failed`);
  return { processed, failed };
}

/** 对单个图片组执行选图脚本并写入结果 */
async function selectImageForGroup(group: ImageGroupView, scriptId: number): Promise<void> {
  const files = getImageFilesByGroup(group.id);

  // 脚本只认临时 uuid，避免让它直接依赖数据库主键
  const filePathByUuid = new Map<string, string>();
  const scriptFiles = files.map((file) => {
    const uuid = randomUUID();
    filePathByUuid.set(uuid, file.filePath);
    return {
      uuid,
      fileName: file.fileName,
      filePath: file.filePath,
      width: file.width,
      height: file.height,
      fileSize: file.fileSize ?? 0,
      ext: file.extension,
    };
  });

  const selectedUuid = await executeScript<string>(scriptId, 'select-image', {
    characterName: group.characterName,
    groupDirPath: group.dirPath,
    files: scriptFiles,
  });

  const selectedFile = filePathByUuid.get(selectedUuid);
  if (!selectedFile) {
    throw new Error('script returned an unknown file marker');
  }

  upsertProcessedImage(
    group.id, group.characterId, group.sourceId, group.dirPath, selectedFile, scriptId,
  );
}
