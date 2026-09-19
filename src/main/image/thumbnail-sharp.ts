import { THUMBNAIL_SIZE } from '@/image/thumbnail-decode';

/**
 * 基于 sharp（libvips）的缩略图实现。
 *
 * 相比内置的纯 JS 解码器，它有两个决定性优势：
 *
 * 1. **按需缩放解码**——libvips 对大图默认 shrink-on-load（1/2、1/4、1/8），
 *    不会先把整图铺成 RGBA 位图；实测 1.3 亿像素的 JPEG 用内置解码器要占
 *    500 MB 以上，这里只需要一个零头。
 * 2. **跨平台**——官方为 win32 / darwin / linux 的 x64 与 arm64 提供预编译包，
 *    而且是 N-API 模块，在 Electron 里不需要 electron-rebuild。
 *
 * sharp 是原生模块，也是缩略图解码的**唯一**实现：加载不了就没有可用的解码路径，
 * 此时直接报错，而不是退回内置的纯 JS 解码器（后者处理大图会慢到被超时打断）。
 */

interface SharpFactory {
  (input: string, options?: { failOn?: string }): SharpInstance;
}

interface SharpInstance {
  rotate(): SharpInstance;
  resize(width: number, height: number, options?: { fit?: string; position?: string }): SharpInstance;
  png(): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

let sharpFactory: SharpFactory | null = null;
let loadError = '';

try {
  // 用 require 而不是 import：加载失败要能被捕获成一条能读的错误
  sharpFactory = require('sharp') as SharpFactory;
} catch (error) {
  loadError = (error as Error).message;
}

/** 取 sharp 实例；没装或加载失败时抛出带修复方式的错误 */
function requireSharp(): SharpFactory {
  if (!sharpFactory) {
    throw new Error(`sharp 不可用（${loadError}），缩略图解码依赖它，请先安装：yarn add sharp`);
  }
  return sharpFactory;
}

/**
 * 用 sharp 生成 50×50 中心裁剪的 PNG。
 *
 * - `rotate()`：按 EXIF 方向摆正，内置解码器没有这个能力
 * - `fit: 'cover'`：等价于中心裁剪成正方形，不必自己算偏移
 *
 * @returns base64 Data URL；格式不支持或文件损坏时返回 null
 */
export async function generateThumbnailWithSharp(filePath: string): Promise<string | null> {
  try {
    const buffer = await requireSharp()(filePath, { failOn: 'none' })
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (error) {
    console.error(`sharp 生成缩略图失败：${filePath}`, (error as Error).message);
    return null;
  }
}
