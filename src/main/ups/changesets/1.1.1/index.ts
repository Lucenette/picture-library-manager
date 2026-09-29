import type { ChangeLogVersion } from '@/ups/engine';

import { run as postups } from './postups';
import dbups from './dbups.xml?raw';

/** 账本里这一版的身份：`package.json` 与目录名都是 1.1.1 */
export const VERSION = '1.1.1';

/**
 * 1.1.1：给各表的文本字段加一列派生排序键（原文 + 排序键并存，键随时可重算）。
 *
 * 结构与索引在 dbups 里；存量行的键只能由 postups 回填——要读原文、算拼音，SQL 给不了。
 */
export const changelog: ChangeLogVersion = { version: VERSION, dbups, postups };
