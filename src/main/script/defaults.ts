import source from '@static/default-script.js?raw';

/**
 * 内置默认脚本。
 *
 * 源码是构建资源（`@static/default-script.js`，由 `?raw` 在构建时内联），不往安装目录铺文件，
 * 也不需要使用者自己去找一个 `default.js` 来加载：库里没有这一条时，由 1.0.1 的预升级脚本
 * （`ups/changesets/1.0.1/preups.ts`）把它写进库。
 * 它不能删除，「恢复默认」就是把它覆盖回这份源码。
 *
 * `path` 是空串——内置脚本没有磁盘来源，这个空串同时就是「内置」的判定依据
 * （见 `enrichScript()`）。
 */
export const BUILTIN_SCRIPT = {
  name: '默认',
  path: '',
  source,
} as const;
