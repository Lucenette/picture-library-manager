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
 * sharp 是原生模块，未安装或加载失败时整个缩略图流程自动回落到纯 JS 解码，
 * 因此它是「可选加速」而不是硬依赖。
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
  // 用 require 而不是 import：模块按需加载，缺失时可捕获并回落
  sharpFactory = require('sharp') as SharpFactory;
} catch (error) {
  loadError = (error as Error).message;
}

/** sharp 是否可用；不可用时调用方应回落到内置解码器 */
export function isSharpAvailable(): boolean {
  return sharpFactory !== null;
}

/** sharp 加载失败的原因，供任务结果与日志展示 */
export function getSharpLoadError(): string {
  return loadError;
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
  if (!sharpFactory) {
    return null;
  }

  try {
    const buffer = await sharpFactory(filePath, { failOn: 'none' })
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
