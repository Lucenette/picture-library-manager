import { join } from 'path';
import type {
  ScannedCharacter, ScannedGroup, ScanTaskPayload, ScanTaskResult, StructureInput, StructureOutput,
} from '@common/types';
import {
  beginBatch, clearGalleryData, endBatch, getGalleryById,
  insertCharacter, insertImageFiles, insertImageGroup, updateGalleryScannedAt,
} from '@/db';
import { buildDirTree, collectImageFiles } from '@/image/walk';
import { executeScript } from '@/script/script-service';
import type { TaskContext } from '@/task/manager';
import { ThumbnailPool } from '@/image/thumbnail-pool';

/**
 * 扫描一个图库。
 *
 * 分三段：识别结构 → 在内存里收集文件与缩略图 → 一次性入库。
 * 目录遍历在主进程但会周期性让出事件循环，图片解码全部交给工作线程，
 * 因此扫描期间主进程仍然能正常响应窗口消息；写库是最后一步且同步完成，
 * 脚本报错、暂停、取消或强制结束都不会在图库里留下半成品。
 */
export async function runScan(ctx: TaskContext): Promise<ScanTaskResult> {
  const { galleryId, scriptId } = ctx.payload as ScanTaskPayload;
  const gallery = getGalleryById(galleryId);
  if (!gallery) {
    throw new Error(`图库不存在（id=${galleryId}）`);
  }

  // ---- 1. 结构识别 ----
  ctx.report(2, '读取目录结构');
  const tree = await buildDirTree(gallery.rootPath);
  await ctx.checkpoint();

  const structure = await executeScript<StructureOutput[]>(scriptId, 'identify-structure', {
    rootPath: gallery.rootPath,
    tree,
  } satisfies StructureInput);
  await ctx.checkpoint();

  // ---- 2. 收集图片文件 ----
  const totalGroups = structure.reduce((sum, item) => sum + item.groups.length, 0);
  const characters: ScannedCharacter[] = [];
  let collectedGroups = 0;

  for (const item of structure) {
    const groups: ScannedGroup[] = [];
    for (const groupRelativePath of item.groups) {
      const dirPath = join(gallery.rootPath, groupRelativePath);
      groups.push({ dirName: groupRelativePath, dirPath, files: await collectImageFiles(dirPath) });

      collectedGroups += 1;
      ctx.report(
        2 + Math.round((collectedGroups / Math.max(totalGroups, 1)) * 18),
        `收集文件 ${collectedGroups}/${totalGroups}`,
      );
      await ctx.checkpoint();
    }
    characters.push({ name: item.name, sourcePath: gallery.rootPath, groups });
  }

  // ---- 3. 在工作线程里补齐宽高与缩略图 ----
  const totalFiles = characters.reduce(
    (sum, character) => sum + character.groups.reduce((count, group) => count + group.files.length, 0),
    0,
  );

  if (totalFiles > 0) {
    await generateThumbnails(ctx, characters, totalFiles);
  }

  // ---- 4. 原子入库 ----
  ctx.report(97, '写入数据库');
  await ctx.checkpoint();

  beginBatch();
  try {
    clearGalleryData(galleryId);
    for (const character of characters) {
      const characterRecord = insertCharacter(galleryId, character.name, character.sourcePath);
      for (const group of character.groups) {
        const groupRecord = insertImageGroup(
          characterRecord.id, group.dirName, group.dirPath, group.files.length,
        );
        if (group.files.length > 0) {
          insertImageFiles(groupRecord.id, group.files);
        }
      }
    }
    updateGalleryScannedAt(galleryId);
  } finally {
    endBatch();
  }

  const thumbnails = characters.reduce(
    (sum, character) => sum + character.groups.reduce(
      (count, group) => count + group.files.filter((file) => file.thumbnail).length, 0,
    ),
    0,
  );

  return {
    characters: characters.length,
    groups: collectedGroups,
    files: totalFiles,
    thumbnails,
  };
}

/**
 * 按线程数分批并发处理缩略图。
 *
 * 批与批之间是暂停与取消的生效点，因此响应延迟约等于一张图的解码时间。
 */
async function generateThumbnails(
  ctx: TaskContext,
  characters: ScannedCharacter[],
  totalFiles: number,
): Promise<void> {
  const pool = new ThumbnailPool();
  const batchSize = pool.concurrency;
  let doneFiles = 0;

  try {
    for (const character of characters) {
      for (const group of character.groups) {
        for (let start = 0; start < group.files.length; start += batchSize) {
          const batch = group.files.slice(start, start + batchSize);

          await Promise.all(batch.map(async (file) => {
            const metrics = await pool.analyze(file.filePath);
            file.width = metrics.width;
            file.height = metrics.height;
            file.thumbnail = metrics.thumbnail;

            doneFiles += 1;
            ctx.report(
              20 + Math.round((doneFiles / Math.max(totalFiles, 1)) * 75),
              `生成缩略图 ${doneFiles}/${totalFiles}`,
            );
          }));

          await ctx.checkpoint();
        }
      }
    }
  } finally {
    pool.terminate();
  }
}
