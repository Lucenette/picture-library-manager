import { homedir } from 'os';
import { join } from 'path';

import { app } from 'electron';

/**
 * 用户目录：应用全部持久化内容的根。
 *
 * 打包态在用户主目录的 `.plmanager/`，开发态在项目的 `dist/`——两边一一对应，
 * 于是 `dist/data` ≙ `~/.plmanager/data`、`dist/scripts` ≙ `~/.plmanager/scripts`。
 *
 * 打包态不能用 exe 同级：Windows 的「覆盖安装」会先静默调用旧版卸载器、清空整个安装目录；
 * Linux 的 deb 装在 root 所有的 `/opt/PLManager`，macOS 的 exe 在 `.app` 内部——都不是能写用户数据的地方。
 */
export function getUserDir(): string {
  return app.isPackaged ? join(homedir(), '.plmanager') : join(process.cwd(), 'dist');
}

/** 应用数据目录：库文件与库备份，属于应用内部数据 */
export function getDataDir(): string {
  return join(getUserDir(), 'data');
}

/** 脚本目录：用户的脚本正文，属于用户资产，与库分开存放 */
export function getScriptsDir(): string {
  return join(getUserDir(), 'scripts');
}

/** 临时目录：草稿这类随时可以丢掉的中间状态 */
export function getTempDir(): string {
  return join(getUserDir(), 'temp');
}

/** 日志目录：运行日志（root / external / script 三个文件），与库、脚本分开存放 */
export function getLogsDir(): string {
  return join(getUserDir(), 'logs');
}
