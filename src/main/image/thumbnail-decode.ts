import { extname } from 'path';

// 解码器与图像处理库统一用 require 引入：它们体积大、内部有动态加载，
// 交给打包器内联会破坏其运行时假设；这些包在打包后由 node_modules 提供。
const { Jimp } = require('jimp');
const { imageSize } = require('image-size');
const jpegJs = require('jpeg-js');
const { PNG: PngJs } = require('pngjs');
const { GifReader } = require('omggif');
const bmpTs = require('bmp-ts');
const utif2 = require('utif2');

/** 缩略图边长（像素） */
const THUMBNAIL_SIZE = 50;

/** 单张图片的元数据与缩略图 */
export interface ThumbnailMetrics {
  width: number | null;
  height: number | null;
  /** base64 Data URL，失败为 null */
  thumbnail: string | null;
}

/** 派发给工作线程的任务 */
export interface ThumbnailRequest {
  id: number;
  filePath: string;
}

/** 工作线程的回复 */
export interface ThumbnailResponse {
  id: number;
  metrics?: ThumbnailMetrics;
  error?: string;
}

/**
 * 读取宽高并生成缩略图。
 *
 * 尺寸用 image-size 只读文件头，即使后面的解码失败也能保留宽高。
 */
export async function analyzeImage(filePath: string): Promise<ThumbnailMetrics> {
  return {
    ...readImageDimensions(filePath),
    thumbnail: await generateThumbnail(filePath),
  };
}

/** 生成缩略图：原图中心最大正方形 → 50×50 → base64，失败返回 null */
async function generateThumbnail(filePath: string): Promise<string | null> {
  try {
    const buffer = require('fs').readFileSync(filePath) as Buffer;
    const bitmap = decodeImage(buffer, extname(filePath).toLowerCase());
    if (!bitmap) {
      return null;
    }

    const size = Math.min(bitmap.width, bitmap.height);
    const x = Math.floor((bitmap.width - size) / 2);
    const y = Math.floor((bitmap.height - size) / 2);

    const image = Jimp.fromBitmap({ width: bitmap.width, height: bitmap.height, data: bitmap.data });
    return await image
      .crop({ x, y, w: size, h: size })
      .resize({ w: THUMBNAIL_SIZE, h: THUMBNAIL_SIZE })
      .getBase64('image/png');
  } catch (error) {
    console.error(`缩略图生成失败：${filePath}`, (error as Error).message);
    return null;
  }
}

/** 读取图片宽高；文件损坏或格式不支持时返回空值 */
function readImageDimensions(filePath: string): { width: number | null; height: number | null } {
  try {
    const dimensions = imageSize(filePath);
    return { width: dimensions.width ?? null, height: dimensions.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * 把图片解码成 RGBA 位图。
 *
 * 使用各格式的原生解码器而不是 Jimp 的读取入口，因为它会吞掉解码参数。
 * 不支持的格式或损坏的文件返回 null。
 */
function decodeImage(buffer: Buffer, extension: string): { width: number; height: number; data: Buffer } | null {
  try {
    if (extension === '.jpg' || extension === '.jpeg') {
      const image = jpegJs.decode(buffer, { maxMemoryUsageInMB: 999999, maxResolutionInMP: 999999 });
      return { width: image.width, height: image.height, data: Buffer.from(image.data) };
    }
    if (extension === '.png') {
      const image = PngJs.sync.read(buffer);
      return { width: image.width, height: image.height, data: Buffer.from(image.data) };
    }
    if (extension === '.gif') {
      const reader = new GifReader(buffer);
      const { width, height } = reader.frameInfo(0);
      const data = Buffer.alloc(width * height * 4);
      reader.decodeAndBlitFrameRGBA(0, data);
      return { width, height, data };
    }
    if (extension === '.bmp') {
      const image = bmpTs.decode(buffer);
      return { width: image.width, height: image.height, data: Buffer.from(image.data) };
    }
    if (extension === '.tiff' || extension === '.tif') {
      const [ifd] = utif2.decode(buffer);
      if (!ifd) {
        return null;
      }
      utif2.decodeImage(buffer, ifd);
      return { width: ifd.width, height: ifd.height, data: Buffer.from(utif2.toRGBA8(ifd)) };
    }
  } catch {
    // 落到下面的 null：损坏或不支持的图片不应中断整轮扫描
  }
  return null;
}
