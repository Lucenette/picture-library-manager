import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** 建一个临时目录，用例自己在 finally 里删 */
export function makeTempDir(prefix = 'plm-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 在临时目录里写一批文件；相对路径的父目录会自动创建 */
export function writeFiles(root: string, files: Record<string, string | Buffer>): void {
  for (const [relative, data] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
