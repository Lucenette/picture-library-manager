import { readdirSync, statSync } from 'fs';
import { extname, join } from 'path';
import { imageSize } from 'image-size';
import { IMAGE_EXTENSIONS } from '@common/image';
import type {
  DirNode, ScannedCharacter, ScannedFile, ScanProgress, StructureOutput,
} from '@common/types';

// 各格式的原生解码器。这里刻意使用 require 而非 import：它们需要按 Node 模块
// 原样加载（依赖 Buffer 与 fs），交给打包器内联会破坏其内部行为。
const { Jimp } = require('jimp');
const jpegJs = require('jpeg-js');
const { PNG: PngJs } = require('pngjs');
const { GifReader } = require('omggif');
const bmpTs = require('bmp-ts');
const utif2 = require('utif2');

/** 缩略图边长（像素） */
const THUMBNAIL_SIZE = 50;

/** 缩略图生成进度 */
export interface ThumbnailProgress {
  current: number;
  total: number;
  currentFile: string;
}

/**
 * 为一批文件生成缩略图，逐个处理并回报进度。
 *
 * @param files 待处理的文件，缩略图写回原对象
 * @param onProgress 每处理完一个文件调用一次
 */
export async function generateThumbnails(
  files: ScannedFile[],
  onProgress?: (progress: ThumbnailProgress) => void,
): Promise<ScannedFile[]> {
  for (const [index, file] of files.entries()) {
    file.thumbnail = await generateThumbnail(file.filePath);
    onProgress?.({ current: index + 1, total: files.length, currentFile: file.fileName });
  }
  return files;
}

/**
 * 构建目录树，只读取目录结构与文件名，不读取图片元数据。
 *
 * @returns 根目录下的节点；children 为 null 表示文件，[] 表示空目录
 */
export function buildDirTree(rootPath: string): DirNode[] {
  const nodes: DirNode[] = [];

  let entries: string[];
  try {
    entries = readdirSync(rootPath);
  } catch {
    return nodes;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue;
    }

    const fullPath = join(rootPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    nodes.push(
      stat.isDirectory()
        ? { name: entry, path: fullPath, children: buildDirTree(fullPath) }
        : { name: entry, path: fullPath, children: null },
    );
  }
  return nodes;
}

/**
 * 按结构脚本的输出扫描图库：结构脚本负责把目录树映射成「角色 → 图片组」，
 * 扫描器只负责把每个图片组里的图片收集起来。
 *
 * @param structure identify-structure 脚本的返回值
 * @param galleryRoot 图库根目录
 * @param onProgress 进度回调
 */
export function scanByStructure(
  structure: StructureOutput[],
  galleryRoot: string,
  onProgress?: (progress: ScanProgress) => void,
): ScannedCharacter[] {
  const characters: ScannedCharacter[] = [];

  for (const item of structure) {
    const character: ScannedCharacter = { name: item.name, sourcePath: galleryRoot, groups: [] };

    for (const groupRelativePath of item.groups) {
      const groupPath = join(galleryRoot, groupRelativePath);
      character.groups.push({
        dirName: groupRelativePath,
        dirPath: groupPath,
        files: collectImageFiles(groupPath),
      });
    }

    characters.push(character);
    onProgress?.(buildProgress(characters, 'scanning', item.name));
  }

  onProgress?.(buildProgress(characters, 'done', null));
  return characters;
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 汇总当前扫描进度 */
function buildProgress(
  characters: ScannedCharacter[],
  stage: ScanProgress['stage'],
  currentCharacter: string | null,
): ScanProgress {
  let groupsFound = 0;
  let filesFound = 0;
  for (const character of characters) {
    groupsFound += character.groups.length;
    for (const group of character.groups) {
      filesFound += group.files.length;
    }
  }
  return { stage, charactersFound: characters.length, groupsFound, filesFound, currentCharacter };
}

/** 判断扩展名是否在收录白名单中 */
function isImageExt(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase().replace('.', ''));
}

/**
 * 递归收集目录下的全部图片文件，忽略以 . 开头的隐藏项。
 *
 * 读不到的目录或文件直接跳过：图库目录通常来自外部，权限与并发改动都不可控。
 */
function collectImageFiles(dirPath: string): ScannedFile[] {
  const files: ScannedFile[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue;
    }

    const fullPath = join(dirPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      files.push(...collectImageFiles(fullPath));
    } else if (stat.isFile() && isImageExt(entry)) {
      files.push({
        fileName: entry,
        filePath: fullPath,
        fileSize: stat.size,
        ...readImageDimensions(fullPath),
        extension: extname(entry).toLowerCase().replace('.', ''),
        thumbnail: null,
      });
    }
  }
  return files;
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

/** 生成缩略图：原图中心最大正方形 → 50×50 → base64 Data URL，失败返回 null */
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
