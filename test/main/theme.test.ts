import { describe, expect, test } from 'vitest';

import { dark, DEFAULT_THEME, light, resolveTheme } from '@common/theme';

/**
 * 主题解析是纯逻辑：不触达 Electron 与 DOM，所以属于「规则内」，必须有断言。
 * 覆盖三种偏好 × 两种系统明暗；令牌键的一致性由 test/scripts/stylesheet-tokens.test.ts 守。
 */
describe('resolveTheme', () => {
  test('静态偏好忽略系统明暗', () => {
    expect(resolveTheme('dark', false)).toBe(dark);
    expect(resolveTheme('dark', true)).toBe(dark);
    expect(resolveTheme('light', false)).toBe(light);
    expect(resolveTheme('light', true)).toBe(light);
  });

  test('system 按传入的系统明暗返回两套之一', () => {
    expect(resolveTheme('system', true)).toBe(dark);
    expect(resolveTheme('system', false)).toBe(light);
  });

  test('默认主题是跟随系统', () => {
    expect(DEFAULT_THEME).toBe('system');
  });
});

/** Monaco 里的一条语法着色规则；token 既可能是词元名，也可能是 TextMate 作用域 */
interface Rule {
  readonly token: string;
  readonly foreground?: string;
}

/**
 * 按 Monaco 的匹配方式取某个作用域最终拿到的颜色。
 *
 * Monaco 的主题是一棵按 `.` 分段的 trie：作用域逐段往下走，走到没有子节点就退回最近一条父规则。
 * 我们的规则每条都给了 foreground，于是它退化成「最长的、是作用域点分前缀的那条规则」。
 */
function foregroundFor(rules: readonly Rule[], scope: string): string | undefined {
  let best: string | undefined;
  let bestLength = -1;
  for (const rule of rules) {
    if (scope !== rule.token && !scope.startsWith(rule.token + '.')) {
      continue;
    }
    if (rule.token.length >= bestLength) {
      bestLength = rule.token.length;
      best = rule.foreground;
    }
  }
  return best;
}

/**
 * 语法规则是纯数据：换成 TextMate 作用域之后，两套主题必须各自把行内/行间注释分开，
 * 并覆盖 JS 语法里不以通用词元名开头的几族作用域。规则写坏不会报类型错，只能靠这里拦。
 */
describe('Monaco 的语法着色规则', () => {
  const themes = [
    ['dark', dark],
    ['light', light],
  ] as const;

  test('两套都把行内注释与行间注释分开着色', () => {
    for (const [name, theme] of themes) {
      const rules = theme.monaco.rules as readonly Rule[];
      const line = foregroundFor(rules, 'comment.line.double-slash.js');
      const block = foregroundFor(rules, 'comment.block.js');
      expect(line, name).toBeDefined();
      expect(block, name).toBeDefined();
      expect(line, name).not.toBe(block);
    }
  });

  test('JS 语法里不以通用词元名开头的几族作用域都有颜色', () => {
    const scopes = [
      'storage.type.js',
      'storage.modifier.js',
      'keyword.operator.arithmetic.js',
      'entity.name.function.js',
      'support.function.js',
      'entity.name.type.js',
      'support.class.js',
      'variable.parameter.js',
      'variable.language.this.js',
    ];
    for (const [name, theme] of themes) {
      const rules = theme.monaco.rules as readonly Rule[];
      for (const scope of scopes) {
        expect(foregroundFor(rules, scope), `${name}: ${scope}`).toBeDefined();
      }
    }
  });

  test('两套都保留内置词法器与语义高亮用的通用词元名规则', () => {
    // 这些既是 TextMate 失败后的降级色，也是 TS 语义高亮（function / type 等）的取色来源，删不得
    const common = ['comment', 'keyword', 'string', 'number', 'constant', 'function', 'type', 'operator', 'delimiter'];
    for (const [name, theme] of themes) {
      const tokens = new Set((theme.monaco.rules as readonly Rule[]).map((rule) => rule.token));
      for (const token of common) {
        expect(tokens.has(token), `${name}: ${token}`).toBe(true);
      }
    }
  });
});
