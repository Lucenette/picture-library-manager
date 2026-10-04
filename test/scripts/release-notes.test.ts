import { test, expect } from 'vitest';

import {
  changelogSections,
  compareVersions,
  formatSections,
  sectionsSinceLastRelease,
} from '@scripts/release-notes.mjs';

const SAMPLE = [
  '# 更新日志',
  '',
  '## [1.2.0] - 未发布',
  '',
  '### 新增',
  '',
  '- 新功能 A',
  '',
  '## [1.1.0] - 2026-09-28',
  '',
  '### 新增',
  '',
  '- 功能 B',
  '',
  '## [1.0.0] - 2026-09-26',
  '',
  '- 首个版本',
  '',
  '[1.2.0]: https://example.com/compare',
].join('\n');

test('小节按出现顺序拆出，链接定义不算正文', () => {
  const sections = changelogSections(SAMPLE);
  expect(sections.map((section: { version: string }) => section.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
  expect(sections[0].body).toContain('新功能 A');
  expect(sections[2].body).not.toContain('example.com');
});

test('版本号比较：三段数字，非版本号标题按「更新」处理', () => {
  expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  expect(compareVersions('未发布', '1.0.0')).toBe(1);
});

test('上次发布以来的小节：按 tag 定位', () => {
  const since = sectionsSinceLastRelease(changelogSections(SAMPLE), 'v1.1.0');
  expect(since.map((section: { version: string }) => section.version)).toEqual(['1.2.0']);
});

test('找不到 tag 那一节时退回版本号比较', () => {
  const since = sectionsSinceLastRelease(changelogSections(SAMPLE), 'v1.0.5');
  expect(since.map((section: { version: string }) => section.version)).toEqual(['1.2.0', '1.1.0']);
});

test('没有 tag 时带上全部非空小节', () => {
  const since = sectionsSinceLastRelease(changelogSections(SAMPLE), '');
  expect(since.map((section: { version: string }) => section.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
});

test('空小节不进结果', () => {
  const since = sectionsSinceLastRelease(changelogSections('## [1.2.0] - 未发布\n\n## [1.0.0]\n\n- x'), '');
  expect(since.map((section: { version: string }) => section.version)).toEqual(['1.0.0']);
});

test('只有一节时原样输出', () => {
  expect(formatSections([{ version: '1.0.0', body: '### 新增\n\n- x' }])).toBe('### 新增\n\n- x');
});

test('多节时按小节名合并条目，不出现内部版本号', () => {
  const text = formatSections([
    { version: '1.2.0', body: '### 新增\n\n- a\n\n### 修复\n\n- c' },
    { version: '1.1.0', body: '### 升级必读\n\n- 先备份\n\n### 新增\n\n- b' },
  ]);
  expect(text).not.toContain('1.2.0');
  expect(text).not.toContain('1.1.0');
  expect(text).toContain('- a\n- b');
  expect(text).toContain('### 修复\n\n- c');
  expect(text.indexOf('### 升级必读')).toBeLessThan(text.indexOf('### 新增'));
});
