import {
  hasScriptCodeColumn, listLegacyScriptSources, setScriptFilePath,
} from '@/database/db';
import { getScriptsDir } from '@/paths';
import { ensureScriptsDir, newScriptPath, scriptFileExists, writeFileAtomic } from '@/script/files';

/**
 * 接管旧脚本：把库里 `code` 列存的源码落成 `scripts/` 下的文件。
 *
 * 这一步必须排在删列的 dbups 之前——列一旦丢掉，除了升级前那份整库备份就没有第二份副本了。
 * 顺序由版本目录固定：preups → dbups → postups，这里抛错就中止整轮升级，那时列还在。
 *
 * 幂等靠「`code` 列还在不在」判断：老库为真、新库为假，接管过之后不会重复落盘。
 */
export async function run(): Promise<void> {
  if (!hasScriptCodeColumn()) {
    return;
  }

  await ensureScriptsDir();
  const scriptsDir = getScriptsDir();

  for (const row of listLegacyScriptSources()) {
    // 内置那条没有磁盘来源（file_path 为空），由 postups 用出厂源码落盘
    if (row.filePath === '' || row.filePath.startsWith(scriptsDir)) {
      continue;
    }
    const target = newScriptPath();
    await writeFileAtomic(target, row.code);
    setScriptFilePath(row.id, target);
  }

  // 自校验：删列之前最后一道闸。逐行确认源码真的落到了文件上，
  // 有任何一行对不上就抛错中止——宁可升级失败，也不能丢了脚本还照删。
  for (const row of listLegacyScriptSources()) {
    if (row.filePath === '') {
      continue;
    }
    if (!(await scriptFileExists(row.filePath))) {
      throw new Error(`接管旧脚本失败：${row.name} 的源码没有落到文件（${row.filePath}）`);
    }
  }
}
