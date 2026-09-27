import source from '@static/default-script.js?raw';

/**
 * 内置默认脚本。
 *
 * 源码是构建资源（`@static/default-script.js`，由 `?raw` 在构建时内联），不往安装目录铺文件，
 * 也不需要使用者自己去找一个 `default.js` 来加载：库里还没有这一条时，由 1.1.0 的收尾脚本
 * （`ups/changesets/1.1.0/postups.ts`）把它写成 `scripts/` 下的一份文件再入库。
 *
 * 谁是内置由 `process_script.builtin` 列判定（不再靠文件路径的形态）；它不能删除，
 * 「恢复默认」就是把它覆盖回这份源码。
 */
export const BUILTIN_SCRIPT = {
  name: '默认',
  source,
} as const;
