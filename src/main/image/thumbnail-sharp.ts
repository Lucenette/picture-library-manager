/**
 * 缩略图解码 + 感知哈希：sharp（libvips）。
 *
 * 这是缩略图解码的**唯一**实现：没有 sharp 就没有可用的解码路径，加载不了直接
 * 抛错，而不是退回纯 JS 解码器——后者处理一亿像素级的图要几十秒、上 GB 内存，
 * 在 Electron 里会被超时打死。
 *
 * 一次解码产出两样东西：
 * 1. 100×100 中心裁剪的 WebP 缩略图（给界面用）
 * 2. 64 位感知哈希（给相似图识别用）
 *
 * 关键是原图**只解一次**：先等比缩到 {@link SOURCE_SIZE}，缩略图与感知哈希都
 * 从这份中转图派生。大 PNG 解两次要好几秒，这样省掉一半。
 * 哈希也刻意算在**整图**上（等比例缩放、不裁切），否则丢掉了构图。
 */

/** 缩略图边长（像素） */
export const THUMBNAIL_SIZE = 100;

/** 中转图边长：原图等比缩到这么大，缩略图与哈希都从它派生 */
const SOURCE_SIZE = 400;

/** WebP 质量：100×100 的缩略图在 75 上看不出损失 */
const THUMBNAIL_QUALITY = 75;

/** 感知哈希的采样边长（DCT 输入） */
const HASH_SAMPLE_SIZE = 32;

/** 感知哈希保留的低频边长：取左上 8×8 */
const HASH_BLOCK_SIZE = 8;

/** 哈希字节数：8×8 位 = 8 字节（丢掉直流后实际用 63 位） */
const HASH_BYTES = (HASH_BLOCK_SIZE * HASH_BLOCK_SIZE) / 8;

/** DCT 余弦表：cos((2x+1)uπ / 2N) */
const DCT_COSINES: readonly number[][] = buildCosines();

interface SharpInputOptions {
  failOn?: string;
  raw?: { width: number; height: number; channels: number };
}

interface SharpMetadata {
  width?: number;
  height?: number;
}

interface SharpOutputInfo {
  width: number;
  height: number;
  channels: number;
}

interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
  rotate(): SharpInstance;
  resize(width: number, height: number, options?: { fit?: string; position?: string; withoutEnlargement?: boolean }): SharpInstance;
  ensureAlpha(): SharpInstance;
  extract(region: { left: number; top: number; width: number; height: number }): SharpInstance;
  greyscale(): SharpInstance;
  raw(): SharpInstance;
  webp(options?: { quality?: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: SharpOutputInfo }>;
}

interface SharpFactory {
  (input: string | Buffer, options?: SharpInputOptions): SharpInstance;
}

/** 一次处理的结果：缩略图与感知哈希都是原始字节，宽高读不出来时为 0 */
export interface ThumbnailResult {
  thumbnail: Uint8Array | null;
  phash: Uint8Array | null;
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
 * 生成缩略图与感知哈希。
 *
 * - `rotate()`：按 EXIF 方向摆正，缩略图与哈希都基于摆正后的图
 * - `metadata()`：只读文件头拿原图宽高，读不出来就是 0
 * - 缩略图 100×100 中心裁剪；哈希取整图 32×32 灰度的 DCT 低频
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
  } catch {
    // 只是拿不到尺寸，退回 0；真正读不出来的图会在下面那次解码里失败并报给调用方
  }

  try {
    // 原图只解这一次
    const source = await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const raw = {
      width: source.info.width,
      height: source.info.height,
      channels: source.info.channels,
    };

    // 缩略图：从中转图里裁中心正方形，再缩到 100×100
    const square = Math.min(raw.width, raw.height);
    const thumbnail = await sharp(source.data, { raw })
      .extract({
        left: Math.floor((raw.width - square) / 2),
        top: Math.floor((raw.height - square) / 2),
        width: square,
        height: square,
      })
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: THUMBNAIL_QUALITY })
      .toBuffer();

    // 感知哈希：同一份中转图缩到 32×32 灰度
    const grey = await sharp(source.data, { raw })
      .resize(HASH_SAMPLE_SIZE, HASH_SAMPLE_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    return { thumbnail, phash: perceptualHash(grey), width, height };
  } catch {
    // 这里在 worker 线程里、够不着主进程的日志文件（见 docs/design/logging.md 3.5）：
    // 退回 null，由调用方（扫描器）连同路径与像素数记一条「这张图解码失败」
    return { thumbnail: null, phash: null, width, height };
  }
}

/** 预计算 DCT 需要的余弦表 */
function buildCosines(): number[][] {
  const table: number[][] = [];
  for (let frequency = 0; frequency < HASH_SAMPLE_SIZE; frequency += 1) {
    const row: number[] = [];
    for (let position = 0; position < HASH_SAMPLE_SIZE; position += 1) {
      row.push(Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * HASH_SAMPLE_SIZE)));
    }
    table.push(row);
  }
  return table;
}

/**
 * 从 {@link HASH_SAMPLE_SIZE} 见方的灰度图算感知哈希。
 *
 * 对整图做 DCT，取左上 8×8 的低频（丢掉只反映整体亮度的直流分量），
 * 与这些系数自己的中位数比大小：大于中位数的位置记 1。
 * 这样重新压缩、换分辨率都只影响一两位，而换构图会大幅改变结果。
 */
function perceptualHash(grey: Uint8Array): Uint8Array {
  const coefficients: number[] = [];
  for (let vertical = 0; vertical < HASH_BLOCK_SIZE; vertical += 1) {
    for (let horizontal = 0; horizontal < HASH_BLOCK_SIZE; horizontal += 1) {
      if (horizontal === 0 && vertical === 0) {
        continue;
      }

      let sum = 0;
      for (let y = 0; y < HASH_SAMPLE_SIZE; y += 1) {
        const cosY = DCT_COSINES[vertical][y];
        for (let x = 0; x < HASH_SAMPLE_SIZE; x += 1) {
          sum += grey[y * HASH_SAMPLE_SIZE + x] * DCT_COSINES[horizontal][x] * cosY;
        }
      }
      coefficients.push(sum);
    }
  }

  const sorted = [...coefficients].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];

  const bytes = new Uint8Array(HASH_BYTES);
  coefficients.forEach((value, index) => {
    if (value > median) {
      bytes[Math.floor(index / 8)] |= 1 << (index % 8);
    }
  });
  return bytes;
}
