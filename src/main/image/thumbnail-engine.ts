import type { ThumbnailOutcome } from '@/image/thumbnail-decode';
import { generateThumbnailWithSharp } from '@/image/thumbnail-sharp';

/**
 * 生成缩略图。
 *
 * 只走 sharp 一条路。刻意不提供「sharp 不可用就回落到内置纯 JS 解码器」的兜底：
 * 那个解码器对一亿像素级的图要几十秒、上 GB 内存，在 Electron 里会被超时打死，
 * 悄悄退过去只会把失败原因藏起来。sharp 没装或加载不了就直接抛错。
 */
export async function generateThumbnail(filePath: string): Promise<ThumbnailOutcome> {
  return { thumbnail: await generateThumbnailWithSharp(filePath), engine: 'sharp' };
}
