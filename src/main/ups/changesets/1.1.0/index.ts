import type { ChangeLogVersion } from '@/ups/engine';

import { run as postups } from './postups';
import { run as preups } from './preups';
import dbups from './dbups.xml?raw';

/**
 * 账本里这一版的身份。
 *
 * **故意停在 `1.0.1`**：这一版做的事（脚本文件库、加载服务、脚本分组）是 minor，所以目录名与
 * `package.json` 都改成了 `1.1.0`，但这个常量在改名之前就已经在开发库的账本里记过账——
 * 改成 `1.1.0` 会让那些 changeSet 按新身份重跑一遍，而 `ALTER TABLE` 重复执行会直接失败。
 * 1.1.0 发出去之后，下一个版本目录照常写自己的版本号。
 */
export const VERSION = '1.0.1';

/**
 * 1.1.0：脚本正文从库里搬到用户目录的 `scripts/` 下。
 *
 * preups 先把旧源码落成文件（删列之前唯一的机会），dbups 才动结构，postups 收尾。
 */
export const changelog: ChangeLogVersion = { version: VERSION, dbups, preups, postups };
