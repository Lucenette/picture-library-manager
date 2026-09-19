import { generateThumbnail as generateWithBuiltin, type ThumbnailOutcome } from '@/image/thumbnail-decode';
import { generateThumbnailWithSharp, isSharpAvailable } from '@/image/thumbnail-sharp';

/**
 * 用当前可用的最佳引擎生成缩略图。
 *
 * 优先 sharp（缩放解码、内存低、跨平台）；未安装或这张图它读不了时，
 * 回落到内置的纯 JS 解码器。返回实际使用的引擎，便于在任务结果里看出
 * 加速到底有没有生效。
 */
export async function generateThumbnail(filePath: string): Promise<ThumbnailOutcome> {
  if (isSharpAvailable()) {
    const thumbnail = await generateThumbnailWithSharp(filePath);
    if (thumbnail !== null) {
      return { thumbnail, engine: 'sharp' };
    }
  }

  return { thumbnail: await generateWithBuiltin(filePath), engine: 'builtin' };
}
