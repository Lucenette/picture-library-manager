import type { SimilarTaskResult } from '@common/types';
import {
  beginBatch, clearSimilarData, endBatch, getSimilarInputRows,
  insertSimilarGroup, insertSimilarMember, insertSimilarRun,
} from '@/database/db';
import { buildSimilarGroups } from '@/image/similar';
import type { TaskContext } from '@/task/manager';

/**
 * 识别相似图片。
 *
 * 比对的是第四页签的图片（每个图片组选定的那一张），每张的感知哈希在扫描时
 * 已经算好，所以这里只读哈希、不碰原图。结果落三张表，只保留最近一次：
 * 先清空再整批写入，写库前的失败不会动到上一次的结果。
 */
export async function runSimilar(ctx: TaskContext): Promise<SimilarTaskResult> {
  ctx.report(5, '读取已选定图片');
  const rows = getSimilarInputRows();
  await ctx.checkpoint();

  ctx.report(20, `比对 ${rows.length} 张图片`);
  const data = await buildSimilarGroups(rows);
  await ctx.checkpoint();

  ctx.report(85, '写入识别结果');
  beginBatch();
  try {
    clearSimilarData();
    const runId = insertSimilarRun(data.compared, data.skipped);
    for (const group of [...data.same, ...data.similar]) {
      const groupId = insertSimilarGroup(runId, group.kind, group.members.length);
      for (const member of group.members) {
        insertSimilarMember(groupId, member.filePath, member.distance);
      }
    }
  } finally {
    endBatch();
  }

  return {
    compared: data.compared,
    skipped: data.skipped,
    sameGroups: data.same.length,
    similarGroups: data.similar.length,
  };
}
