import type { ChangeLogFile } from '@/database/changeset';

import v1 from './1.0.0.xml?raw';

/**
 * 全部 changelog 文件。
 *
 * 顺序即执行顺序，必须与版本号递增一致；文件名取 `package.json` 里的版本号，
 * 因此一个版本最多一个文件。新增结构变更时新建下一个版本的文件，并在末尾追加一行。
 */
export const CHANGELOG_FILES: readonly ChangeLogFile[] = [
  { filename: '1.0.0', content: v1 },
];
