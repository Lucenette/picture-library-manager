import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, test } from 'vitest';

import { dark, light } from '@common/theme';

/**
 * 颜色只有一个来源：`src/common/theme/` 的主题对象。
 *
 * 允许写死字面色值的只有两处，都有理由：
 * - `src/common/theme/` 本身就是那份来源；
 * - `src/renderer/entries/shell/first-paint.ts` 的内联片段要早于外链 CSS 生效，那时变量还不存在。
 *
 * 注释里的色值不算——说明文字里引用具体颜色是正常的。
 */
const ALLOWED = ['src/renderer/entries/shell/first-paint.ts'];
/** 主题目录本身就是那份来源：一套主题一个文件，色值只允许出现在这里 */
const THEME_DIR = 'src/common/theme/';
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
      if (ALLOWED.includes(file) || file.startsWith(THEME_DIR)) {
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

  test('两套主题的 --app-* 令牌键完全一致', () => {
    const appKeys = (tokens: Record<string, string | undefined>): string[] =>
      Object.keys(tokens).filter((key) => key.startsWith('--app-')).sort();
    expect(appKeys(light.tokens)).toEqual(appKeys(dark.tokens));
  });

  /**
   * 字号、圆角与过渡时长也必须有令牌出处：散着写字面量时，同一种语义会漂成好几个值。
   *
   * 确实需要一次性取值的（展示性字形等），在那一行写明 `style-literal-ok` 与理由——
   * 例外要能被 review 看见，而不是悄悄放行。
   */
  test('字号、圆角与过渡时长只允许取令牌', () => {
    const rules = [
      { name: '字号', re: /font-size:\s*\d+(?:\.\d+)?px/ },
      { name: '圆角', re: /border-radius:\s*\d+(?:\.\d+)?px/ },
      { name: '过渡时长', re: /transition:[^;]*\d+(?:\.\d+)?(?:s|ms)\b/ },
    ];
    const files = collect(join(process.cwd(), 'src', 'renderer')).filter((file) => /\.(vue|css)$/.test(file));
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const full of files) {
      const file = relative(process.cwd(), full).split('\\').join('/');
      readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
        if (line.includes('style-literal-ok')) {
          return;
        }
        for (const rule of rules) {
          if (rule.re.test(line)) {
            offenders.push(file + ':' + (index + 1) + ' ' + rule.name + ' ' + line.trim());
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
