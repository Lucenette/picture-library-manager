import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, test } from 'vitest';

/**
 * 颜色只有一个来源：`src/common/theme.ts` 的主题对象。
 *
 * 允许写死字面色值的只有两处，都有理由：
 * - `src/common/theme.ts` 本身就是那份来源；
 * - `src/renderer/entries/shell/first-paint.ts` 的内联片段要早于外链 CSS 生效，那时变量还不存在。
 *
 * 注释里的色值不算——说明文字里引用具体颜色是正常的。
 */
const ALLOWED = ['src/common/theme.ts', 'src/renderer/entries/shell/first-paint.ts'];
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/;

/** 去掉块注释与行注释，避免说明文字里的色值被当成用法 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 递归列出 src/ 下所有会写颜色的文件 */
function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
    } else if (/\.(ts|vue|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('颜色的唯一来源', () => {
  test('字面色值只允许出现在主题对象与首帧片段里', () => {
    const files = collect(join(process.cwd(), 'src'));
    // 防呆：走空了也会"通过"，所以先确认真的扫到了文件
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const full of files) {
      const file = relative(process.cwd(), full).split('\\').join('/');
      if (ALLOWED.includes(file)) {
        continue;
      }
      for (const line of stripComments(readFileSync(full, 'utf8')).split('\n')) {
        if (COLOR.test(line)) {
          offenders.push(file + ': ' + line.trim());
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
