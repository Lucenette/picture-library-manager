/**
 * 生成可扫描的样例图库到 dist/fixture/。
 *
 * 零依赖：PNG / BMP / SVG 用 Node 内置能力就地构造，JPEG / WebP / GIF 写入内嵌的
 * 最小有效字节。每次运行先清空目标目录，可重复执行。
 *
 * 用法：node scripts/make-fixture.mjs
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist', 'fixture');

// ------------------------------------------------------------
// 图片构造
// ------------------------------------------------------------

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value;
  }
  return table;
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function pngSolid(width, height, rgb) {
  const rowSize = width * 3 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * rowSize;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = rgb[0];
      raw[at + 1] = rgb[1];
      raw[at + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function bmpSolid(width, height, rgb) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelSize = rowSize * height;
  const buffer = Buffer.alloc(54 + pixelSize);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(54 + pixelSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelSize, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = 54 + y * rowSize + x * 3;
      buffer[at] = rgb[2];
      buffer[at + 1] = rgb[1];
      buffer[at + 2] = rgb[0];
    }
  }
  return buffer;
}

function svgSolid(width, height, rgb) {
  const color = 'rgb(' + rgb.join(',') + ')';
  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">';
  const body = '<rect width="100%" height="100%" fill="' + color + '"/></svg>';
  return Buffer.from(head + body, 'utf8');
}

/** 1x1 的 JPEG / WebP / GIF：各自格式族里最小的合法样本，宽高已用 image-size 验证 */
const JPEG_1X1 = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const WEBP_1X1 = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// ------------------------------------------------------------
// 写盘
// ------------------------------------------------------------

/** 写一个文件；父目录不存在时自动创建 */
function put(relativePath, data) {
  const target = join(OUT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

const BLUE = [58, 110, 190];
const GREEN = [60, 150, 90];
const ORANGE = [200, 120, 50];
const PURPLE = [130, 80, 180];

/** 三个来源覆盖文档里出现过的目录规范，外加一组必须被处理但不该让流程崩掉的输入 */
function buildFixture() {
  rmSync(OUT, { recursive: true, force: true });

  // 来源一：三端壁纸（角色 / 图片组 / 设备分类）
  put('三端壁纸/A-阿波尼亚/A-阿波尼亚-01/无损原图/电脑.png', pngSolid(240, 135, BLUE));
  put('三端壁纸/A-阿波尼亚/A-阿波尼亚-01/无损原图/手机.png', pngSolid(135, 240, BLUE));
  put('三端壁纸/A-阿波尼亚/A-阿波尼亚-01/高清压缩/电脑.jpg', JPEG_1X1);
  put('三端壁纸/A-阿波尼亚/A-阿波尼亚-02/电脑.png', pngSolid(240, 135, BLUE));
  put('三端壁纸/S-神里绫人/S-神里绫人-01/电脑.png', pngSolid(240, 135, GREEN));
  put('三端壁纸/S-神里绫人/S-神里绫人-01/手机.webp', WEBP_1X1);

  // 来源二：动漫游戏人物（长名称图片组、编号开头的角色、角色下直接放图）
  put('动漫游戏人物/A-阿尼亚/01 阿尼亚 转存后再下载 防丢失/电脑.png', pngSolid(200, 300, ORANGE));
  put('动漫游戏人物/A-阿尼亚/01 阿尼亚 转存后再下载 防丢失/手机.jpg', JPEG_1X1);
  put('动漫游戏人物/A-阿尼亚/01 阿尼亚 转存后再下载 防丢失/封面.png', pngSolid(200, 300, ORANGE));
  put('动漫游戏人物/51雷电将军/51雷电将军-01/电脑.webp', WEBP_1X1);
  put('动漫游戏人物/散图角色/电脑.png', pngSolid(240, 135, PURPLE));
  put('动漫游戏人物/散图角色/手机.jpg', JPEG_1X1);
  put('动漫游戏人物/散图角色/Thumbs.db', Buffer.from('non-image', 'utf8'));

  // 来源三：边界情况
  const edge = '边界情况/Z-测试角色/Z-测试角色-01/';
  put(edge + '正常.png', pngSolid(240, 135, BLUE));
  put(edge + '损坏.png', Buffer.from('this is not a real png', 'utf8'));
  put(edge + '空文件.png', Buffer.alloc(0));
  put(edge + '超宽.png', pngSolid(512, 4, GREEN));
  put(edge + '超高.png', pngSolid(4, 512, GREEN));
  put(edge + '动图.gif', GIF_1X1);
  put(edge + '矢量.svg', svgSolid(120, 120, ORANGE));
  put(edge + '位图.bmp', bmpSolid(64, 64, PURPLE));
  put(edge + '说明.txt', Buffer.from('非图片文件，扫描时应跳过', 'utf8'));
  put(edge + 'Thumbs.db', Buffer.from('non-image', 'utf8'));
}

buildFixture();
console.log('样例图库已生成：' + OUT);
console.log('把 dist/fixture 下的「三端壁纸」「动漫游戏人物」「边界情况」分别作为来源添加。');
