import type { ChangeLogVersion } from '@/ups/engine';

import { run as preups } from './preups';

/** 版本号写死在这里：目录改名不影响账本身份 */
export const VERSION = '1.0.1';

/**
 * 1.0.1 的升级内容：只有预升级脚本，还没有结构变更。
 *
 * 脚本管理改造会往这个目录里补 dbups.xml 与 postups.ts。
 */
export const changelog: ChangeLogVersion = { version: VERSION, preups };
