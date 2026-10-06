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
