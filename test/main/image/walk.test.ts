import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { buildDirTree, collectImageFiles } from '@/image/walk';

import { makeTempDir, removeTempDir, writeFiles } from '@test/setup/temp-dir';

/** 用仓库自带的图标当一张真实可读的图片 */
const ICON = readFileSync(join(process.cwd(), 'src/static/icon.png'));

test('buildDirTree 跳过隐藏项：文件 children 为 null，空目录为 []', async () => {
  const dir = makeTempDir();
  try {
    writeFiles(dir, {
      'a.png': ICON,
      '.hidden.png': ICON,
      'empty/.keep': '',
      'sub/b.png': ICON,
    });
    const nodes = await buildDirTree(dir);
    expect(nodes.map((node) => node.name).sort()).toEqual(['a.png', 'empty', 'sub']);
    expect(nodes.find((node) => node.name === 'a.png')?.children).toBeNull();
    expect(nodes.find((node) => node.name === 'empty')?.children).toEqual([]);
    expect(nodes.find((node) => node.name === 'sub')?.children?.map((child) => child.name)).toEqual(['b.png']);
  } finally {
    removeTempDir(dir);
  }
});

test('collectImageFiles 递归收集白名单图片，跳过非图片与隐藏目录', async () => {
  const dir = makeTempDir();
  try {
    writeFiles(dir, {
      'a.png': ICON,
      'notes.txt': 'hello',
      'sub/b.png': ICON,
      '.hidden/c.png': ICON,
    });
    const files = await collectImageFiles(dir);
    expect(files.map((file) => file.fileName).sort()).toEqual(['a.png', 'b.png']);
    const png = files.find((file) => file.fileName === 'a.png');
    expect(png?.extension).toBe('png');
    expect(png?.fileSize).toBe(ICON.length);
    expect(png?.width).toBeGreaterThan(0);
    expect(png?.height).toBeGreaterThan(0);
    expect(png?.thumbnail).toBeNull();
    expect(png?.phash).toBeNull();
  } finally {
    removeTempDir(dir);
  }
});

test('读不出尺寸的图片给 0 × 0，而不是 null', async () => {
  const dir = makeTempDir();
  try {
    writeFiles(dir, { 'broken.png': 'not an image' });
    const files = await collectImageFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].width).toBe(0);
    expect(files[0].height).toBe(0);
  } finally {
    removeTempDir(dir);
  }
});

test('目录不存在时返回空数组而不是抛错', async () => {
  const dir = makeTempDir();
  try {
    expect(await collectImageFiles(join(dir, 'nope'))).toEqual([]);
    expect(await buildDirTree(join(dir, 'nope'))).toEqual([]);
  } finally {
    removeTempDir(dir);
  }
});
