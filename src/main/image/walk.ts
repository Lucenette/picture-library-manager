// ============================================================
// 图库图片处理流水线
//
// 本目录负责「把图库目录变成可入库的图片记录」：
//   walk.ts             目录遍历（I/O，主进程分片让出）
//   thumbnail-pool.ts   解码用的线程池
//   thumbnail-worker.ts 线程入口，只负责收发消息
//   thumbnail-decode.ts 读尺寸、解码、缩放（纯 CPU）
//
// 分界线只有一条：能不能放主线程——遍历是 I/O，解码是纯 CPU。
// ============================================================

import { readdirSync, statSync } from 'fs';
import { extname, join } from 'path';
import type { DirNode, ScannedFile } from '@common/types';

// 只读图片头几 KB 就能拿到宽高；扫描器需要它来估算解码内存，决定哪些图能并发。
// 同样用 require：与其它图像库一致，不交给打包器内联。
const { imageSize } = require('image-size');

/** 每处理这么多条目就让出一次事件循环，避免长时间霸占主进程 */
const YIELD_EVERY = 200;

/**
 * 收录进图库的图片扩展名（小写、不含点）。
 *
 * 只决定「哪些文件会被扫描入库」，不等于「哪些格式能生成缩略图」——
 * 后者取决于 sharp 能否解出这张图，解不出来就计入任务结果的失败张数。
 */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico',
]);

/** 已遍历的条目数；扫描是串行的，用模块级计数即可 */
let walkedEntries = 0;

/** 让出一次事件循环 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 遍历计步：累计到阈值就让出一次 */
async function step(): Promise<void> {
  walkedEntries += 1;
  if (walkedEntries % YIELD_EVERY === 0) {
    await yieldToEventLoop();
  }
}

/**
 * 构建目录树，只读取目录结构与文件名。
 *
 * 只做 readdir/stat 与图片头读取（拿到宽高供调度用），不做任何解码；
 * 真正吃内存的缩略图生成全部在工作线程里。
 *
 * @returns 根目录下的节点；children 为 null 表示文件，[] 表示空目录
 */
export async function buildDirTree(rootPath: string): Promise<DirNode[]> {
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

    if (stat.isDirectory()) {
      nodes.push({ name: entry, path: fullPath, children: await buildDirTree(fullPath) });
    } else {
      nodes.push({ name: entry, path: fullPath, children: null });
    }
    await step();
  }
  return nodes;
}

/**
 * 递归收集目录下的图片文件，只带文件名、路径、大小与扩展名。
 *
 * 宽高与缩略图留空，由工作线程补齐；读不到的目录或文件直接跳过——
 * 图库目录来自外部，权限与并发改动都不可控。
 */
export async function collectImageFiles(dirPath: string): Promise<ScannedFile[]> {
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
      files.push(...await collectImageFiles(fullPath));
    } else if (stat.isFile() && isImageExt(entry)) {
      files.push({
        fileName: entry,
        filePath: fullPath,
        fileSize: stat.size,
        ...readImageDimensions(fullPath),
        extension: extname(entry).toLowerCase().replace('.', ''),
        // 缩略图与感知哈希由工作线程解码时补齐
        thumbnail: null,
        phash: null,
      });
    }
    await step();
  }
  return files;
}

/**
 * 读图片头拿宽高。
 *
 * 放在遍历阶段而不是解码线程里，是因为扫描器要根据「宽 × 高 × 4」估算解码
 * 需要多少内存，才能决定这张图能不能和别的图一起并发解码。
 */
function readImageDimensions(filePath: string): { width: number; height: number } {
  try {
    const dimensions = imageSize(filePath);
    return { width: dimensions.width ?? 0, height: dimensions.height ?? 0 };
  } catch {
    // 读不出来就是 0，不要 null：界面直接显示 0 × 0
    return { width: 0, height: 0 };
  }
}

/** 判断扩展名是否在收录白名单中 */
function isImageExt(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase().replace('.', ''));
}
