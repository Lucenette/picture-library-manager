import { getScriptByPath, upsertScript } from '@/database/db';
import { BUILTIN_SCRIPT } from '@/script/defaults';

/**
 * 把内置默认脚本插进库。
 *
 * 这一段是 1.0.1 的版本动作：内置脚本叫什么、源码从哪来、已经存在时不动它，这三条都写在这里；
 * 数据库那边只提供「按路径查」与「写进去」两个能力，不再认识「内置默认脚本」这个概念。
 *
 * 库里已经有内置那条时什么都不做——老库升级走的正是这条路，不会覆盖使用者改过的代码。
 */
export function run(): void {
  if (getScriptByPath(BUILTIN_SCRIPT.path)) {
    return;
  }
  upsertScript(BUILTIN_SCRIPT.name, BUILTIN_SCRIPT.path, BUILTIN_SCRIPT.source);
}
