import { join } from 'path';
import type {
  Character, ScannedCharacter, ScannedFile, ScannedGroup, ScanTaskPayload, ScanTaskResult,
  StructureInput, StructureOutput, ThumbnailEngineName,
} from '@common/types';
import {
  beginBatch, clearSourceData, endBatch, getSourceById,
  insertCharacter, insertImageFiles, insertImageGroup, updateSourceScannedAt,
} from '@/database/db';
import { buildDirTree, collectImageFiles } from '@/image/walk';
import { createLogger } from '@/log';
import { executeScript } from '@/script/script-service';
import type { TaskContext } from '@/task/manager';
import { ThumbnailPool } from '@/image/thumbnail-pool';

/** 本模块的日志（category `main.scan`） */
const log = createLogger('scan');

/** 已入库的图片组：带上 group 行 id，逐张插图时要用 */
interface StoredGroup extends ScannedGroup {
  groupId: number;
}

/** 扫描中的角色：组已经写进数据库，文件留到下一步逐张处理 */
type StoredCharacter = Omit<ScannedCharacter, 'groups'> & { groups: StoredGroup[] };

/**
 * 扫描一个来源。
 *
 * 顺序是既定的：**先清除该来源的既有数据，再把扫描结果写回去**。
 * 清除本身立刻提交，之后**每张图各自一条 INSERT**——写完一张就落一张，
 * 扫描中途出错或被取消，已经解出来并写进去的图都留在库里。
 * 目录遍历在主进程但会周期性让出事件循环，图片解码交给工作线程。
 */
export async function runScan(ctx: TaskContext): Promise<ScanTaskResult> {
  const { sourceId, scriptId } = ctx.payload as ScanTaskPayload;
  const source = getSourceById(sourceId);
  if (!source) {
    throw new Error(`source not found (id=${sourceId})`);
  }

  log.info(`scan started: source ${source.name} (id=${sourceId})`);

  const characters: StoredCharacter[] = [];
  let collectedGroups = 0;
  let totalFiles = 0;
  let failedWrites = 0;
  let thumbnailFailures = 0;
  let thumbnailEngine: ThumbnailEngineName | 'none' = 'none';

  /** 记下写入失败但继续扫描：一个目录写不进去不该拖垮整轮 */
  const recordWriteFailure = (what: string, error: unknown): void => {
    failedWrites += 1;
    log.error(`write failed: ${what}`, error);
  };

  // 先清除本来源的旧数据，清除立刻提交
  beginBatch();
  try {
    clearSourceData(sourceId);
  } finally {
    endBatch();
  }

  // ---- 1. 结构识别 ----
  ctx.report(2, '读取目录结构');
  const tree = await buildDirTree(source.rootPath);
  await ctx.checkpoint();

  const structure = await executeScript<StructureOutput[]>(scriptId, 'identify-structure', {
    rootPath: source.rootPath,
    tree,
  } satisfies StructureInput);
  await ctx.checkpoint();

  // ---- 2. 逐角色逐组建好结构：角色与组各自一条 INSERT，写不进去就跳过继续 ----
  const totalGroups = structure.reduce((sum, item) => sum + item.groups.length, 0);

  for (const item of structure) {
    let characterRecord: Character;
    try {
      characterRecord = insertCharacter(sourceId, item.name, source.rootPath);
    } catch (error) {
      recordWriteFailure(`角色「${item.name}」`, error);
      continue;
    }

    const groups: StoredGroup[] = [];
    for (const groupRelativePath of item.groups) {
      collectedGroups += 1;
      try {
        const dirPath = join(source.rootPath, groupRelativePath);
        const files = await collectImageFiles(dirPath);
        const groupRecord = insertImageGroup(
          characterRecord.id, groupRelativePath, dirPath, files.length,
        );
        groups.push({ dirName: groupRelativePath, dirPath, files, groupId: groupRecord.id });
      } catch (error) {
        recordWriteFailure(`目录「${groupRelativePath}」`, error);
      }

      ctx.report(
        2 + Math.round((collectedGroups / Math.max(totalGroups, 1)) * 18),
        `收集文件 ${collectedGroups}/${totalGroups}`,
      );
      await ctx.checkpoint();
    }
    characters.push({ name: item.name, sourcePath: source.rootPath, groups });
  }

    // ---- 3. 逐张生成缩略图并立刻入库：一张一条 INSERT，写一张落一张 ----
  totalFiles = characters.reduce(
    (sum, character) => sum + character.groups.reduce((count, group) => count + group.files.length, 0),
    0,
  );

  if (totalFiles > 0) {
    const outcome = await generateThumbnails(ctx, characters, totalFiles);
    thumbnailFailures = outcome.failures;
    thumbnailEngine = outcome.engine;
  }

  updateSourceScannedAt(sourceId);

  if (failedWrites > 0) {
    log.error(`scan finished with ${failedWrites} write failures, source data may be incomplete`);
  }

  const thumbnails = characters.reduce(
    (sum, character) => sum + character.groups.reduce(
      (count, group) => count + group.files.filter((file) => file.thumbnail).length, 0,
    ),
    0,
  );

  log.info(`scan finished: ${characters.length} characters, ${collectedGroups} groups, ${totalFiles} files, ${thumbnails} thumbnails (${thumbnailFailures} failed, engine=${thumbnailEngine})`);

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
 * 逐张生成缩略图并立即入库。
 *
 * 一批同时解线程池规模那么多张；sharp 按需缩放解码，单张内存很小，
 * 不再按内存估算分批。每个批次之后是暂停 / 取消的生效点，单张失败只让它
 * 自己没有缩略图，写库失败只让它自己缺一行。
 *
 * @returns 生成失败的张数，以及实际用到的解码引擎
 */
async function generateThumbnails(
  ctx: TaskContext,
  characters: StoredCharacter[],
  totalFiles: number,
): Promise<{ failures: number; engine: ThumbnailEngineName | 'none' }> {
  const pool = new ThumbnailPool();
  // 强制结束 / 退出时立刻掐掉解码线程，不等 runner 走到下一个检查点
  ctx.onAbort(() => pool.terminate());
  const batchSize = pool.concurrency;
  let doneFiles = 0;
  let storedFiles = 0;
  let failures = 0;

  const analyzeFile = async (group: StoredGroup, file: ScannedFile): Promise<void> => {
    const startedAt = Date.now();
    const size = `${file.width}×${file.height}`;
    try {
      const outcome = await pool.analyze(file.filePath);
      file.thumbnail = outcome.thumbnail;
      file.phash = outcome.phash;
      // sharp 读到的宽高优先；它读不出就用遍历阶段 image-size 的结果
      if (outcome.width > 0) {
        file.width = outcome.width;
      }
      if (outcome.height > 0) {
        file.height = outcome.height;
      }
      if (outcome.thumbnail === null) {
        // 解码失败也要计数并报出来，不能只剩一个「这张图没有缩略图」
        failures += 1;
        log.error(`thumbnail generation failed: ${file.filePath} (${size}) - decoder cannot read this image`);
      }
    } catch (error) {
      failures += 1;
      // 带上像素数与实际耗时，只报「超时」看不出是图太大还是解码器卡死
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      log.error(`thumbnail generation failed: ${file.filePath} (${size}, ${seconds}s)`, error);
    }

    // 无论这张有没有缩略图都立刻入库；写失败只让它自己缺一行
    try {
      insertImageFiles(group.groupId, [file]);
      storedFiles += 1;
    } catch (error) {
      log.error(`store image failed: ${file.filePath}`, error);
    }

    doneFiles += 1;
    ctx.report(
      20 + Math.round((doneFiles / Math.max(totalFiles, 1)) * 75),
      `写入图片 ${doneFiles}/${totalFiles}`,
    );
  };

  try {
    for (const character of characters) {
      for (const group of character.groups) {
        let batch: ScannedFile[] = [];

        const flushBatch = async (): Promise<void> => {
          if (batch.length === 0) {
            return;
          }
          const current = batch;
          batch = [];

          await Promise.all(current.map((file) => analyzeFile(group, file)));
          await ctx.checkpoint();
        };

        for (const file of group.files) {
          if (batch.length >= batchSize) {
            await flushBatch();
          }
          batch.push(file);
        }

        await flushBatch();
      }
    }
  } finally {
    pool.terminate();
  }

  return { failures, engine: pool.engine };
}
