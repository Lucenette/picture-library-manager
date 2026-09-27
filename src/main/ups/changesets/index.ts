import type { ChangeLogVersion } from '@/ups/engine';

import { changelog as v100 } from './1.0.0';
import { changelog as v101 } from './1.0.1';

/**
 * 全部版本目录，顺序即执行顺序，必须与版本号递增一致。
 *
 * 每个版本目录自己报出内容（版本号写死在各自的 index.ts 里），这里只负责排队：
 * 目录名对代码没有意义，改名不影响账本身份；新增一个版本就在末尾追加一行。
 */
export const CHANGELOG_VERSIONS: readonly ChangeLogVersion[] = [v100, v101];
