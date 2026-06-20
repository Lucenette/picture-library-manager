import {readdirSync, statSync} from 'fs';
import {extname, join} from 'path';
import {imageSize} from 'image-size';
import {IMAGE_EXTENSIONS, VIRTUAL_GROUP_NAME} from '@/db/database';
import type {ScannedCharacter, ScannedFile, ScanProgress} from '@common/types';

const { Jimp } = require('jimp');
const jpegJs = require('jpeg-js');
const { PNG: PngJs } = require('pngjs');
const { GifReader } = require('omggif');
const bmpTs = require('bmp-ts');
const utif2 = require('utif2');

/**
 * 全格式解码为 { width, height, data: Buffer(RGBA) }
 * 用各格式原生解码器，不依赖 jimp.read（它有 bug 吞 options）
 */
function decodeImage(buf: Buffer, ext: string): { width: number; height: number; data: Buffer } | null {
  try {
    if (ext === '.jpg' || ext === '.jpeg') {
      const img = jpegJs.decode(buf, { maxMemoryUsageInMB: 999999, maxResolutionInMP: 999999 });
      return { width: img.width, height: img.height, data: Buffer.from(img.data) };
    }
    if (ext === '.png') {
      const img = PngJs.sync.read(buf);
      return { width: img.width, height: img.height, data: Buffer.from(img.data) };
    }
    if (ext === '.gif') {
      const reader = new GifReader(buf);
      const { width, height } = reader.frameInfo(0);
      const data = Buffer.alloc(width * height * 4);
      reader.decodeAndBlitFrameRGBA(0, data);
      return { width, height, data };
    }
    if (ext === '.bmp') {
      const img = bmpTs.decode(buf);
      return { width: img.width, height: img.height, data: Buffer.from(img.data) };
    }
    if (ext === '.tiff' || ext === '.tif') {
      const [ifd] = utif2.decode(buf);
      if (!ifd) return null;
      utif2.decodeImage(buf, ifd);
      const rgba = new Uint8Array(utif2.toRGBA8(ifd));
      return { width: ifd.width, height: ifd.height, data: Buffer.from(rgba) };
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * 生成缩略图：原图中心最大正方形 → 50x50 → base64
 * 失败返回 null（文件损坏或格式不支持）
 */
async function generateThumbnail(filePath: string): Promise<string | null> {
  try {
    const fs = require('fs');
    const buf = fs.readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    const raw = decodeImage(buf, ext);
    if (!raw) return null;

    const size = Math.min(raw.width, raw.height);
    const x = Math.floor((raw.width - size) / 2);
    const y = Math.floor((raw.height - size) / 2);

    const img = Jimp.fromBitmap({ width: raw.width, height: raw.height, data: raw.data });
    return await img.crop({x, y, w: size, h: size}).resize({w: 50, h: 50}).getBase64('image/png');
  } catch (e: any) {
    console.error(`缩略图失败: ${filePath}`, e.message);
    return null;
  }
}

/** 缩略图生成进度回调 */
export interface ThumbnailProgress {
  current: number;
  total: number;
  currentFile: string;
}

/**
 * 为一批文件生成缩略图（逐个处理，报告进度）
 */
export async function generateThumbnails(
  files: ScannedFile[],
  onProgress?: (p: ThumbnailProgress) => void,
): Promise<ScannedFile[]> {
  const total = files.length;
  for (let i = 0; i < total; i++) {
    const f = files[i];
    f.thumbnail = await generateThumbnail(f.filePath);
    if (onProgress) onProgress({ current: i + 1, total, currentFile: f.fileName });
  }
  return files;
}

/**
 * 目录扫描器
 *
 * 扫描逻辑：
 * 1. 图库根目录 → 第一层子目录 = 角色
 * 2. 角色目录 → 第一层子目录 = 图片组（没有子目录但有图片 → 虚拟组）
 * 3. 图片组 → 递归收集所有图片文件（按扩展名白名单过滤）
 * 4. 读取每个图片文件的宽高和大小
 */

/**
 * 判断扩展名是否在白名单中
 */
function isImageExt(filename: string): boolean {
  const ext = extname(filename).toLowerCase().replace('.', '');
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * 递归收集目录下所有图片文件
 * 忽略以 . 开头的隐藏文件和目录
 */
function collectImageFiles(dirPath: string): ScannedFile[] {
  const result: ScannedFile[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      const fullPath = join(dirPath, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue; // 权限不足或文件已删除，跳过
      }

      if (stat.isDirectory()) {
        result.push(...collectImageFiles(fullPath));
      } else if (stat.isFile() && isImageExt(entry)) {
        let width: number | null = null;
        let height: number | null = null;
        try {
          const dims = imageSize(fullPath);
          width = dims.width ?? null;
          height = dims.height ?? null;
        } catch {
          // 读取尺寸失败（损坏文件等），宽高留空
        }

        result.push({
          fileName: entry,
          filePath: fullPath,
          fileSize: stat.size,
          width,
          height,
          extension: extname(entry).toLowerCase().replace('.', ''),
          thumbnail: null,
        });
      }
    }
  } catch {
    // 目录不可读，跳过
  }

  return result;
}

/**
 * 扫描单个图库目录
 *
 * @param galleryPath 图库根目录的绝对路径
 * @param onProgress  进度回调
 * @returns 扫描结果（角色列表及图片组）
 */
export function scanGallery(
  galleryPath: string,
  onProgress?: (progress: ScanProgress) => void,
): ScannedCharacter[] {
  const characters: ScannedCharacter[] = [];

  // 获取角色目录列表（第一层子目录）
  let charEntries: string[];
  try {
    charEntries = readdirSync(galleryPath);
  } catch {
    return characters;
  }

  for (const charEntry of charEntries) {
    if (charEntry.startsWith('.')) continue;

    const charPath = join(galleryPath, charEntry);
    let charStat;
    try {
      charStat = statSync(charPath);
    } catch {
      continue;
    }

    if (!charStat.isDirectory()) continue;

    const character: ScannedCharacter = {
      name: charEntry,
      sourcePath: charPath,
      groups: [],
    };

    // 获取图片组（角色目录下的第一层子目录）
    const groupEntries = readdirSync(charPath);
    const subDirs: string[] = [];
    const looseFiles: ScannedFile[] = [];

    for (const ge of groupEntries) {
      if (ge.startsWith('.')) continue;

      const gePath = join(charPath, ge);
      let geStat;
      try {
        geStat = statSync(gePath);
      } catch {
        continue;
      }

      if (geStat.isDirectory()) {
        subDirs.push(ge);
      } else if (geStat.isFile() && isImageExt(ge)) {
        // 散放图片文件 —— 后续归入虚拟组
        let width: number | null = null;
        let height: number | null = null;
        try {
          const dims = imageSize(gePath);
          width = dims.width ?? null;
          height = dims.height ?? null;
        } catch {
          // ignore
        }
        looseFiles.push({
          fileName: ge,
          filePath: gePath,
          fileSize: geStat.size,
          width,
          height,
          extension: extname(ge).toLowerCase().replace('.', ''),
          thumbnail: null,
        });
      }
    }

    // 处理子目录（正常图片组）
    for (const sd of subDirs) {
      const groupPath = join(charPath, sd);
      const files = collectImageFiles(groupPath);
      character.groups.push({
        dirName: sd,
        dirPath: groupPath,
        files,
      });
    }

    // 处理散放文件（虚拟组）
    if (looseFiles.length > 0) {
      character.groups.push({
        dirName: VIRTUAL_GROUP_NAME,
        dirPath: charPath,
        files: looseFiles,
      });
    }

    characters.push(character);

    // 进度回调
    if (onProgress) {
      onProgress({
        stage: 'scanning',
        charactersFound: characters.length,
        groupsFound: characters.reduce((sum, c) => sum + c.groups.length, 0),
        filesFound: characters.reduce((sum, c) => sum + c.groups.reduce((s, g) => s + g.files.length, 0), 0),
        currentCharacter: charEntry,
      });
    }
  }

  // 扫描完成
  if (onProgress) {
    onProgress({
      stage: 'done',
      charactersFound: characters.length,
      groupsFound: characters.reduce((sum, c) => sum + c.groups.length, 0),
      filesFound: characters.reduce((sum, c) => sum + c.groups.reduce((s, g) => s + g.files.length, 0), 0),
      currentCharacter: null,
    });
  }

  return characters;
}
