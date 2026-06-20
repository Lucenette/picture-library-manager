import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { imageSize } from 'image-size';
import { IMAGE_EXTENSIONS, VIRTUAL_GROUP_NAME } from '@/db/database';
import type { ScannedFile, ScannedGroup, ScannedCharacter, ScanProgress } from '../../common/types';

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
