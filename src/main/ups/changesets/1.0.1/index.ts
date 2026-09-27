import type { ChangeLogVersion } from '@/ups/engine';

import { run as postups } from './postups';
import { run as preups } from './preups';
import dbups from './dbups.xml?raw';

/** 版本号写死在这里：目录改名不影响账本身份 */
export const VERSION = '1.0.1';

/**
 * 1.0.1：脚本正文从库里搬到用户目录的 `scripts/` 下。
 *
 * preups 先把旧源码落成文件（删列之前唯一的机会），dbups 才动结构，postups 收尾。
 */
export const changelog: ChangeLogVersion = { version: VERSION, dbups, preups, postups };
