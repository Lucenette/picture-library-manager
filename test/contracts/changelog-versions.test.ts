import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

const CHANGESETS = join(process.cwd(), 'src/main/ups/changesets');

/** 各版本目录的 VERSION 常量：目录名只给人看，身份以代码里的常量为准 */
function versionsByDir(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of readdirSync(CHANGESETS, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const text = readFileSync(join(CHANGESETS, entry.name, 'index.ts'), 'utf8');
    const match = /export const VERSION = '([^']+)'/.exec(text);
    if (match !== null) {
      map.set(entry.name, match[1]);
    }
  }
  return map;
}

/** 按 changesets/index.ts 里的 import 顺序取出实际执行顺序 */
function executionOrder(): string[] {
  const text = readFileSync(join(CHANGESETS, 'index.ts'), 'utf8');
  const dirs: string[] = [];
  for (const match of text.matchAll(/from '\.\/([^']+)'/g)) {
    dirs.push(match[1]);
  }
  const byDir = versionsByDir();
  return dirs.map((dir) => byDir.get(dir) ?? dir);
}

function compareVersion(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

test('版本号在清单里唯一', () => {
  const values = [...versionsByDir().values()];
  expect(new Set(values).size).toBe(values.length);
});

test('清单按版本号递增排列', () => {
  const order = executionOrder();
  const sorted = [...order].sort(compareVersion);
  expect(order).toEqual(sorted);
});
