import type { ChangeLogVersion } from '@/ups/engine';

import dbups from './dbups.xml?raw';

/** 版本号写死在这里：目录改名不影响账本身份 */
export const VERSION = '1.0.0';

/** 1.0.0 引入的全部结构；这一版没有升级脚本 */
export const changelog: ChangeLogVersion = { version: VERSION, dbups };
