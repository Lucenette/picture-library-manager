import {
  getAllScripts, getBuiltinScript, insertScript, renameScript, setScriptFilePath, setScriptTypes,
} from '@/database/db';
import { detectScriptTypes } from '@/script/compile';
import { BUILTIN_SCRIPT } from '@/script/defaults';
import { ensureScriptsDir, newScriptPath, scriptFileExists, writeFileAtomic } from '@/script/files';

/** 去掉名字末尾的脚本扩展名：`default.js` → `default` */
function stripScriptExtension(name: string): string {
  return name.replace(/\.(c|m)?js$/, '');
}

/**
 * 升级收尾：把存量脚本名里的扩展名统一去掉，再保证内置脚本有磁盘来源。
 *
 * 剥名字放在这里而不是 preups，是因为图库里的名字副本（`processed_image.script_name`）
 * 要等本版本的 dbups 才建出来；在这里改名，renameScript() 的级联正好把副本一起改掉。
 *
 * 内置脚本两种情况都覆盖：新库还没有这一条 → 建文件 + 插行；老库已有那一行（file_path 为空，
 * 或者文件被外部删了）→ 按出厂源码把文件写出来再回填路径。
 */
export async function run(): Promise<void> {
  for (const script of getAllScripts()) {
    const stripped = stripScriptExtension(script.name);
    if (stripped !== '' && stripped !== script.name) {
      renameScript(script.id, stripped);
    }
  }

  await ensureScriptsDir();
  const builtin = getBuiltinScript();

  if (builtin === undefined) {
    const filePath = newScriptPath();
    await writeFileAtomic(filePath, BUILTIN_SCRIPT.source);
    const created = insertScript(BUILTIN_SCRIPT.name, filePath, true);
    setScriptTypes(created.id, detectScriptTypes(BUILTIN_SCRIPT.source, filePath));
    return;
  }

  if (builtin.filePath !== '' && (await scriptFileExists(builtin.filePath))) {
    return;
  }

  const filePath = builtin.filePath === '' ? newScriptPath() : builtin.filePath;
  await writeFileAtomic(filePath, BUILTIN_SCRIPT.source);
  setScriptFilePath(builtin.id, filePath);
  setScriptTypes(builtin.id, detectScriptTypes(BUILTIN_SCRIPT.source, filePath));
}
