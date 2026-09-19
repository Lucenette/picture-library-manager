import { join } from 'path';
import type {
  ScannedCharacter, ScannedFile, ScannedGroup, ScanTaskPayload, ScanTaskResult,
  StructureInput, StructureOutput, ThumbnailEngineName,
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
 * 同时解码的内存预算。
 *
 * 解码一张图要按「宽 × 高 × 4」分配 RGBA 缓冲区，外加解码器的内部缓冲；
 * 几张一亿像素级的图并发就足以吃穿内存、让系统开始换页，单张解码从十秒
 * 恶化到几分钟。按内存预算分批后：普通图照旧并发，超大图独占一批。
 *
 * 注意不能用文件体积来判断——实测 7.6 MB 的 JPEG 就要 380 MB 内存。
 */
const DECODE_MEMORY_BUDGET_BYTES = 768 * 1024 * 1024;

/**
 * 每个像素的估算字节数。
 *
 * RGBA 本身是 4 字节，再留一倍余量覆盖解码器的内部缓冲与内存碎片——
 * 实测解码期间的 RSS 约为 RGBA 缓冲区的 1.9 倍。
 */
const DECODE_BYTES_PER_PIXEL = 8;

/** 读不出尺寸时的保守估算，避免这类文件被当成小图塞满一整批 */
const UNKNOWN_SIZE_BYTES = 64 * 1024 * 1024;

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

  let thumbnailFailures = 0;
  let thumbnailEngine: ThumbnailEngineName | 'none' = 'none';
  if (totalFiles > 0) {
    const outcome = await generateThumbnails(ctx, characters, totalFiles);
    thumbnailFailures = outcome.failures;
    thumbnailEngine = outcome.engine;
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
    thumbnailFailures,
    thumbnailEngine,
  };
}

/**
 * 生成缩略图。
 *
 * 分批依据是**解码所需内存**而不是文件体积：一批里所有图片的
 * 「宽 × 高 × 4」之和不超过 {@link DECODE_MEMORY_BUDGET_BYTES}，同时不超过
 * 线程数。这样普通图片照旧并发，一亿像素级的大图自然独占一批。
 * 每个批次之后都是一个暂停 / 取消的生效点，单张失败只让它自己没有缩略图。
 *
 * @returns 生成失败的张数，以及实际用到的解码引擎
 */
async function generateThumbnails(
  ctx: TaskContext,
  characters: ScannedCharacter[],
  totalFiles: number,
): Promise<{ failures: number; engine: ThumbnailEngineName | 'none' }> {
  const pool = new ThumbnailPool();
  const batchSize = pool.concurrency;
  let doneFiles = 0;
  let failures = 0;

  /** 估算一张图解码要占多少内存 */
  const estimateBytes = (file: ScannedFile): number => {
    const pixels = (file.width ?? 0) * (file.height ?? 0);
    return pixels > 0 ? pixels * DECODE_BYTES_PER_PIXEL : UNKNOWN_SIZE_BYTES;
  };

  const analyzeFile = async (file: ScannedFile): Promise<void> => {
    try {
      const outcome = await pool.analyze(file.filePath, estimateBytes(file));
      file.thumbnail = outcome.thumbnail;
    } catch (error) {
      failures += 1;
      console.error(`缩略图生成失败：${file.filePath}`, (error as Error).message);
    }

    doneFiles += 1;
    ctx.report(
      20 + Math.round((doneFiles / Math.max(totalFiles, 1)) * 75),
      `生成缩略图 ${doneFiles}/${totalFiles}`,
    );
  };

  try {
    for (const character of characters) {
      for (const group of character.groups) {
        let batch: ScannedFile[] = [];
        let batchBytes = 0;

        const flushBatch = async (): Promise<void> => {
          if (batch.length === 0) {
            return;
          }
          const current = batch;
          batch = [];
          batchBytes = 0;

          await Promise.all(current.map(analyzeFile));
          await ctx.checkpoint();
        };

        for (const file of group.files) {
          const bytes = estimateBytes(file);
          const overBudget = batchBytes + bytes > DECODE_MEMORY_BUDGET_BYTES;

          if (batch.length > 0 && (overBudget || batch.length >= batchSize)) {
            await flushBatch();
          }

          batch.push(file);
          batchBytes += bytes;
        }

        await flushBatch();
      }
    }
  } finally {
    pool.terminate();
  }

  return { failures, engine: pool.engine };
}
