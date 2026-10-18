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
  readonly fontStyle?: string;
}

/**
 * 按 Monaco 的匹配方式取某个作用域最终命中的那条规则。
 *
 * Monaco 的主题是一棵按 `.` 分段的 trie：作用域逐段往下走，走到没有子节点就退回最近一条父规则。
 * 我们的规则每条都是完整的 token，于是它退化成「最长的、是作用域点分前缀的那条规则」。
 */
function ruleFor(rules: readonly Rule[], scope: string): Rule | undefined {
  let best: Rule | undefined;
  let bestLength = -1;
  for (const rule of rules) {
    if (scope !== rule.token && !scope.startsWith(rule.token + '.')) {
      continue;
    }
    if (rule.token.length >= bestLength) {
      bestLength = rule.token.length;
      best = rule;
    }
  }
  return best;
}

/** 某个作用域最终拿到的颜色 */
function foregroundFor(rules: readonly Rule[], scope: string): string | undefined {
  return ruleFor(rules, scope)?.foreground;
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

  test('两套都定义了行内、块与文档注释的着色，暗色下文档注释与其它两种不同色', () => {
    for (const [name, theme] of themes) {
      const rules = theme.monaco.rules as readonly Rule[];
      for (const scope of ['comment.line.double-slash.js', 'comment.block.js', 'comment.block.documentation.js']) {
        expect(foregroundFor(rules, scope), `${name}: ${scope}`).toBeDefined();
      }
    }
    // Islands Dark 里只有文档注释是绿的，行内与普通块注释同为灰；Light 方案三者同灰，这是方案本身的选择
    const darkRules = dark.monaco.rules as readonly Rule[];
    expect(foregroundFor(darkRules, 'comment.block.documentation.js'))
      .not.toBe(foregroundFor(darkRules, 'comment.line.double-slash.js'));
  });

  test('编辑器底色与工具窗口底色一致', () => {
    // 脚本页的列表与编辑区靠这一条连成一片：Islands 的 ToolWindow.background 与编辑器方案的
    // attributes.TEXT.BACKGROUND 在暗色（#191a1c）与浅色（#ffffff）下本来就相同
    for (const [name, theme] of themes) {
      expect(theme.monaco.colors['editor.background'], name).toBe(theme.tokens['--app-bg-tool-window']);
    }
  });

  test('JS 语法里不以通用词元名开头的几族作用域都有颜色', () => {
    const scopes = [
      'storage.type.js',
      'storage.modifier.js',
      'keyword.operator.arithmetic.js',
      'constant.numeric.decimal.js',
      'constant.character.escape.js',
      'constant.language.boolean.true.js',
      'entity.name.function.js',
      'support.function.js',
      'entity.name.type.class.js',
      'support.class.promise.js',
      'variable.other.readwrite.js',
      'variable.other.property.js',
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

  test('斜体与粗体字形按方案落到对应作用域', () => {
    // 浅色方案的区分度相当一部分来自字形，只断言颜色会漏掉它
    const darkRules = dark.monaco.rules as readonly Rule[];
    const lightRules = light.monaco.rules as readonly Rule[];
    expect(ruleFor(darkRules, 'comment.line.double-slash.js')?.fontStyle).toBe('italic');
    expect(ruleFor(darkRules, 'keyword.control.flow.js')?.fontStyle).toBe('bold');
    expect(ruleFor(darkRules, 'variable.language.this.js')?.fontStyle).toBe('italic');
    expect(ruleFor(lightRules, 'comment.line.double-slash.js')?.fontStyle).toBe('italic');
    expect(ruleFor(lightRules, 'constant.language.boolean.true.js')?.fontStyle).toBe('italic');
    expect(ruleFor(lightRules, 'variable.language.this.js')?.fontStyle).toBe('bold italic');
  });

  test('数字不会被 constant 那条通用规则抢走', () => {
    for (const [name, theme] of themes) {
      const rules = theme.monaco.rules as readonly Rule[];
      expect(foregroundFor(rules, 'constant.numeric.decimal.js'), name)
        .not.toBe(foregroundFor(rules, 'constant.language.boolean.true.js'));
    }
  });

  test('浅色的关键字、数字、正则与类型各占一色', () => {
    // Light 方案里这几个族有三种是蓝的、类型没设值，是浅色看着平的主因；这条守住拆分结果
    const rules = light.monaco.rules as readonly Rule[];
    const scopes = [
      'keyword.control.flow.js',
      'constant.numeric.decimal.js',
      'string.regexp.js',
      'entity.name.type.class.js',
    ];
    const colors = scopes.map((scope) => foregroundFor(rules, scope));
    for (const [index, color] of colors.entries()) {
      expect(color, scopes[index]).toBeDefined();
    }
    expect(new Set(colors).size).toBe(scopes.length);
    // 转义归字符串一族，靠粗体跟普通字符串区分
    expect(foregroundFor(rules, 'constant.character.escape.js')).toBe(foregroundFor(rules, 'string.quoted.double.js'));
    expect(ruleFor(rules, 'constant.character.escape.js')?.fontStyle).toBe('bold');
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
