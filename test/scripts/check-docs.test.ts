import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from 'vitest';

const ROOT = process.cwd();

function run(): { status: number | null; output: string } {
  const result = spawnSync('node', ['scripts/check-docs.mjs'], { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, output: (result.stdout ?? '') + (result.stderr ?? '') };
}

test('当前文档通过检查', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.output).toContain('文档检查通过');
});

test('识别残留的占位符', () => {
  const probe = join(ROOT, 'docs/_checkdocs_probe.md');
  try {
    writeFileSync(probe, '# 探针\n\n<待填写>\n');
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('_checkdocs_probe.md');
  } finally {
    rmSync(probe, { force: true });
  }
});
