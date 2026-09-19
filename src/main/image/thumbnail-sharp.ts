/**
 * 缩略图解码：sharp（libvips）。
 *
 * 这是缩略图解码的**唯一**实现：没有 sharp 就没有可用的解码路径，加载不了直接
 * 抛错，而不是退回纯 JS 解码器——后者处理一亿像素级的图要几十秒、上 GB 内存，
 * 在 Electron 里会被超时打死。相比纯 JS 解码器有两个决定性优势：
 *
 * 1. **按需缩放解码**——libvips 对大图默认 shrink-on-load（1/2、1/4、1/8），
 *    不会先把整图铺成 RGBA 位图，一亿像素的图只要一个零头。
 * 2. **跨平台**——官方为 win32 / darwin / linux 的 x64 与 arm64 提供预编译包，
 *    而且是 N-API 模块，在 Electron 里不需要 electron-rebuild。
 */

/** 缩略图边长（像素） */
export const THUMBNAIL_SIZE = 50;

interface SharpFactory {
  (input: string, options?: { failOn?: string }): SharpInstance;
}

interface SharpMetadata {
  width?: number;
  height?: number;
}

interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
  rotate(): SharpInstance;
  resize(width: number, height: number, options?: { fit?: string; position?: string }): SharpInstance;
  png(): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

/** 一次缩略图生成的结果；宽高读不出来时为 0 */
export interface ThumbnailResult {
  thumbnail: string | null;
  width: number;
  height: number;
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
 * 生成 50×50 中心裁剪的 PNG，并读出原图宽高。
 *
 * - `metadata()`：只读文件头，读不出来宽高就是 0
 * - `rotate()`：按 EXIF 方向摆正
 * - `fit: 'cover'`：等价于中心裁剪成正方形，不必自己算偏移
 *
 * 缩略图生成失败（格式不支持、文件损坏）时 thumbnail 为 null，但宽高仍会
 * 尽量返回——调用方按「这张图没有缩略图」处理。
 */
export async function generateThumbnail(filePath: string): Promise<ThumbnailResult> {
  const sharp = requireSharp();

  // 先读宽高：后面解码失败也要能拿到尺寸
  let width = 0;
  let height = 0;
  try {
    const metadata = await sharp(filePath, { failOn: 'none' }).metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;
  } catch (error) {
    console.error(`读取图片尺寸失败：${filePath}`, (error as Error).message);
  }

  try {
    const buffer = await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();

    return { thumbnail: `data:image/png;base64,${buffer.toString('base64')}`, width, height };
  } catch (error) {
    console.error(`sharp 生成缩略图失败：${filePath}`, (error as Error).message);
    return { thumbnail: null, width, height };
  }
}
