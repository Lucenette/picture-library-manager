import { extname } from 'path';
import type { ThumbnailEngineName } from '@common/types';

// 解码器与图像处理库统一用 require 引入：它们体积大、内部有动态加载，
// 交给打包器内联会破坏其运行时假设；这些包在打包后由 node_modules 提供。
const { Jimp } = require('jimp');
const jpegJs = require('jpeg-js');
const { PNG: PngJs } = require('pngjs');
const { GifReader } = require('omggif');
const bmpTs = require('bmp-ts');
const utif2 = require('utif2');

/** 缩略图边长（像素） */
export const THUMBNAIL_SIZE = 50;

/** 单个输出像素在源区域上最多采样的点数（每个方向） */
const MAX_SAMPLES_PER_AXIS = 4;

/** jpeg-js 的内存与分辨率上限，让它在分配前报错，而不是撑死线程 */
const JPEG_MAX_MEMORY_MB = 2048;
const JPEG_MAX_RESOLUTION_MP = 400;

/** 解码后的 RGBA 位图；data 直接用解码器给出的缓冲区，不再复制一份 */
interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** 派发给工作线程的任务 */
export interface ThumbnailRequest {
  id: number;
  filePath: string;
}

/** 工作线程的回复 */
export interface ThumbnailResponse {
  id: number;
  /** base64 Data URL；生成不出来时为 null */
  thumbnail?: string | null;
  /** 实际使用的解码引擎 */
  engine?: ThumbnailEngineName;
  error?: string;
}

/** 一次缩略图生成的结果与所用引擎 */
export interface ThumbnailOutcome {
  thumbnail: string | null;
  engine: ThumbnailEngineName;
}

/**
 * 生成缩略图：中心正方形 → 50×50 → base64，失败返回 null。
 *
 * 任何尺寸都尝试解码——缩略图的作用就是让大图也能快速预览。能不能与其它图
 * 并发解码由调用方按内存预算决定，这里不做尺寸判断。
 */
export async function generateThumbnail(filePath: string): Promise<string | null> {
  try {
    const buffer = require('fs').readFileSync(filePath) as Buffer;
    const bitmap = decodeImage(buffer, extname(filePath).toLowerCase());
    if (!bitmap) {
      return null;
    }

    return await encodeThumbnail(bitmap);
  } catch (error) {
    console.error('缩略图生成失败：' + filePath, (error as Error).message);
    return null;
  }
}

/**
 * 把整图缩到 50×50 见方并编码成 PNG。
 *
 * 刻意绕开 Jimp 的 crop + resize：那会在整图上再分配一整份缓冲区，对大幅壁纸
 * 等于把峰值内存翻倍。这里直接按网格抽样写出 50×50，只有输出缓冲区的开销，
 * 之后再把这张小图交给 Jimp 编码。
 */
async function encodeThumbnail(bitmap: Bitmap): Promise<string> {
  const size = Math.min(bitmap.width, bitmap.height);
  const offsetX = Math.floor((bitmap.width - size) / 2);
  const offsetY = Math.floor((bitmap.height - size) / 2);
  const cell = size / THUMBNAIL_SIZE;

  const output = Buffer.alloc(THUMBNAIL_SIZE * THUMBNAIL_SIZE * 4);
  for (let y = 0; y < THUMBNAIL_SIZE; y += 1) {
    for (let x = 0; x < THUMBNAIL_SIZE; x += 1) {
      sampleCell(bitmap, offsetX, offsetY, cell, x, y, output);
    }
  }

  const image = Jimp.fromBitmap({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, data: output });
  return image.getBase64('image/png');
}

/** 对某个输出像素对应的源区域等距抽样取平均，避免最近邻缩放的锯齿 */
function sampleCell(
  bitmap: Bitmap,
  offsetX: number,
  offsetY: number,
  cell: number,
  outX: number,
  outY: number,
  output: Buffer,
): void {
  const startX = offsetX + Math.floor(outX * cell);
  const startY = offsetY + Math.floor(outY * cell);
  const endX = Math.max(startX + 1, offsetX + Math.floor((outX + 1) * cell));
  const endY = Math.max(startY + 1, offsetY + Math.floor((outY + 1) * cell));

  const stepX = Math.max(1, Math.floor((endX - startX) / MAX_SAMPLES_PER_AXIS));
  const stepY = Math.max(1, Math.floor((endY - startY) / MAX_SAMPLES_PER_AXIS));

  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;

  for (let sourceY = startY; sourceY < endY; sourceY += stepY) {
    for (let sourceX = startX; sourceX < endX; sourceX += stepX) {
      const index = (sourceY * bitmap.width + sourceX) * 4;
      red += bitmap.data[index];
      green += bitmap.data[index + 1];
      blue += bitmap.data[index + 2];
      alpha += bitmap.data[index + 3];
      count += 1;
    }
  }

  const target = (outY * THUMBNAIL_SIZE + outX) * 4;
  output[target] = Math.round(red / count);
  output[target + 1] = Math.round(green / count);
  output[target + 2] = Math.round(blue / count);
  output[target + 3] = Math.round(alpha / count);
}

/**
 * 把图片解码成 RGBA 位图。
 *
 * 使用各格式的原生解码器而不是 Jimp 的读取入口，因为它会吞掉解码参数；
 * 并且直接沿用解码器给出的缓冲区，不再用 Buffer.from 复制一份——对大幅图片
 * 那次复制就是几百 MB。
 */
function decodeImage(buffer: Buffer, extension: string): Bitmap | null {
  try {
    if (extension === '.jpg' || extension === '.jpeg') {
      const image = jpegJs.decode(buffer, {
        maxMemoryUsageInMB: JPEG_MAX_MEMORY_MB,
        maxResolutionInMP: JPEG_MAX_RESOLUTION_MP,
      });
      return { width: image.width, height: image.height, data: image.data };
    }
    if (extension === '.png') {
      const image = PngJs.sync.read(buffer);
      return { width: image.width, height: image.height, data: image.data };
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
      return { width: image.width, height: image.height, data: image.data };
    }
    if (extension === '.tiff' || extension === '.tif') {
      const [ifd] = utif2.decode(buffer);
      if (!ifd) {
        return null;
      }
      utif2.decodeImage(buffer, ifd);
      return { width: ifd.width, height: ifd.height, data: utif2.toRGBA8(ifd) };
    }
  } catch {
    // 落到下面的 null：损坏或不支持的图片不应中断整轮扫描
  }
  return null;
}
