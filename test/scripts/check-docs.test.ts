import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from 'vitest';

import { checkDocuments } from '@scripts/check-docs.mjs';

/**
 * 起一个最小仓库树：三个索引目录的 README + 一份探针文档。
 * 全落在系统临时目录里，测试不再往真实仓库的 docs/ 写探针。
 * @param {string} probe 探针文档内容
 * @returns {string} 临时仓库根
 */
function makeRoot(probe: string): string {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-'));
  for (const dir of ['docs/roadmap', 'docs/design', 'docs/todo']) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'README.md'), '# 索引\n');
  }
  writeFileSync(join(root, 'docs/_probe.md'), probe);
  return root;
}

test('当前文档通过检查', () => {
  const result = checkDocuments(process.cwd());
  expect(result.violations).toEqual([]);
  expect(result.fileCount).toBeGreaterThan(0);
});

test('识别残留的占位符', () => {
  const root = makeRoot('# 探针\n\n<待填写>\n');
  try {
    const result = checkDocuments(root);
    expect(result.violations.map((item: { file: string }) => item.file)).toContain('docs/_probe.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('相对链接指向不存在的目标时报错', () => {
  const root = makeRoot('# 探针\n\n[missing](./nope.md)\n');
  try {
    const result = checkDocuments(root);
    expect(result.violations.map((item: { message: string }) => item.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('链接目标不存在')]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
