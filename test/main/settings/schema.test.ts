import { describe, expect, test } from 'vitest';

import { DEFAULT_SETTINGS } from '@common/settings';

import { parseSettings, sanitizePatch, serializeSettings } from '@/settings/schema';

/**
 * 设置文件的解析与生成是纯逻辑：不触达 Electron 与 fs（那是 store 的事），所以属于「规则内」。
 * 覆盖的重点是「设置绝不挡住启动」——坏文件、坏值、缺键一律退回默认值，且坏在哪要能被记下来。
 */
describe('parseSettings', () => {
  test('空文件是正常状态：全用默认值，不算错误', () => {
    expect(parseSettings('')).toEqual({ settings: DEFAULT_SETTINGS, unknown: {}, errors: [] });
    expect(parseSettings('   \n')).toEqual({ settings: DEFAULT_SETTINGS, unknown: {}, errors: [] });
  });

  test('只写了注释的文件同样是正常状态（js-yaml v5 的 load 会对它抛错，所以走 loadAll）', () => {
    expect(parseSettings('# 我的设置\n')).toEqual({ settings: DEFAULT_SETTINGS, unknown: {}, errors: [] });
  });

  test('多个文档时用第一个，但要报出来：多出来的内容不会被写回', () => {
    const parsed = parseSettings('theme: dark\n---\nother: 1\n');
    expect(parsed.settings).toEqual({ theme: 'dark' });
    expect(parsed.errors).toEqual(['settings file has 2 documents, using the first one']);
  });

  test('认得的值照收', () => {
    expect(parseSettings('theme: light').settings).toEqual({ theme: 'light' });
  });

  test('坏 YAML 退回默认值，并交出原因（原因要进日志，所以是英文）', () => {
    const parsed = parseSettings('theme: [light');
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatch(/^settings file is not valid YAML: /);
  });

  test('根不是映射也退回默认值', () => {
    expect(parseSettings('- light').settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('just a string').errors).toEqual(['settings file must be a mapping']);
  });

  test('值非法退回默认值，但同文件里合法的键照收', () => {
    const parsed = parseSettings('theme: blue');
    expect(parsed.settings).toEqual(DEFAULT_SETTINGS);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toContain('invalid theme');
  });

  test('键缺失时只补缺的那个键', () => {
    expect(parseSettings('unrelated: 1').settings).toEqual(DEFAULT_SETTINGS);
  });

  test('未知键原样留下：别的版本写的键不会被这一版抹掉', () => {
    const parsed = parseSettings('theme: dark\nfutureThing:\n  nested: true\n');
    expect(parsed.settings).toEqual({ theme: 'dark' });
    expect(parsed.unknown).toEqual({ futureThing: { nested: true } });
  });
});

describe('serializeSettings', () => {
  test('已知键在前、未知键在后，且能被自己解析回来', () => {
    const text = serializeSettings({ theme: 'dark' }, { futureThing: { nested: true } });
    expect(text.indexOf('theme:')).toBeLessThan(text.indexOf('futureThing:'));

    const parsed = parseSettings(text);
    expect(parsed.settings).toEqual({ theme: 'dark' });
    expect(parsed.unknown).toEqual({ futureThing: { nested: true } });
  });
});

describe('sanitizePatch', () => {
  test('只收已知键', () => {
    expect(sanitizePatch({ theme: 'light' })).toEqual({ patch: { theme: 'light' }, errors: [] });
  });

  test('值非法与未知键都拒绝，且文案是给界面看的中文', () => {
    const result = sanitizePatch({ theme: 'blue', futureThing: 1 });
    expect(result.patch).toEqual({});
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join()).toContain('主题取值不合法');
    expect(result.errors.join()).toContain('没有这个设置项');
  });

  test('不是映射就整条拒绝', () => {
    expect(sanitizePatch(null).patch).toEqual({});
    expect(sanitizePatch(['theme']).errors).toHaveLength(1);
  });
});
