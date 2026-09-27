/**
 * 生成 Release 说明：提交信息、更新详情（取自 CHANGELOG）、各平台产物、安装与升级提示。
 *
 * 运行：node scripts/release-notes.mjs > RELEASE_NOTES.md
 * CI 由 .github/workflows/release.yml 的 release job 调用；本地可用环境变量覆盖：
 *   GITHUB_SHA / GITHUB_REF_NAME / GITHUB_REPOSITORY / ARTIFACTS_DIR
 * 缺少 git 或没有产物目录时降级输出，不报错——说明本身仍要能生成。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = resolve(ROOT, process.env.ARTIFACTS_DIR ?? 'artifacts');

/** 取 git 输出；环境里没有 git 时返回空串，调用方自行降级 */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** 从 CHANGELOG 里取出某个版本的正文；优先按版本号找，找不到就退回「未发布」 */
function changelogSection(text, version) {
  const lines = text.split('\n');
  const candidates = [version, '未发布'].map((token) => `[${token}]`);
  for (const token of candidates) {
    const start = lines.findIndex((line) => line.startsWith('## ') && line.includes(token));
    if (start < 0) {
      continue;
    }
    const body = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith('## ')) {
        break;
      }
      if (/^\[/.test(line)) {
        break;
      }
      body.push(line);
    }
    return body.join('\n').trim();
  }
  return '';
}

/**
 * 列出产物：按顶层目录（平台）分组，带大小。
 * 自动更新的元数据（`latest.yml`、`.blockmap`）不上表——它们是给更新器用的，不是给人装的包。
 */
function collectArtifacts() {
  if (!existsSync(ARTIFACTS)) {
    return [];
  }
  /** 产物 artifact 名 → 说明里显示的平台名 */
  const LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  const groups = [];
  for (const entry of readdirSync(ARTIFACTS, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const files = [];
    const walk = (dir) => {
      for (const child of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, child.name);
        if (child.isDirectory()) {
          walk(full);
        } else {
          files.push({ name: relative(ARTIFACTS, full).replaceAll('\\', '/'), bytes: statSync(full).size });
        }
      }
    };
    if (entry.isDirectory()) {
      walk(join(ARTIFACTS, entry.name));
    } else {
      files.push({ name: entry.name, bytes: statSync(join(ARTIFACTS, entry.name)).size });
    }
    groups.push({ platform: LABELS[entry.name] ?? entry.name, files: files
      .filter((file) => !file.name.endsWith('.yml') && !file.name.endsWith('.blockmap'))
      .sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return groups;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const sha = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']);
const tag = process.env.GITHUB_REF_NAME || git(['describe', '--tags', '--exact-match']) || ('v' + pkg.version);
const repo = process.env.GITHUB_REPOSITORY || '';
const previous = sha ? git(['describe', '--tags', '--abbrev=0', sha + '^']) : '';
const section = changelogSection(changelog, pkg.version);

const out = [];
out.push('## 提交');
out.push('');
out.push('- Tag：`' + tag + '`');
if (sha) {
  out.push('- 提交：`' + sha + '`' + (repo ? '（[在 GitHub 上查看](https://github.com/' + repo + '/commit/' + sha + ')）' : ''));
}
if (repo && previous && tag) {
  out.push('- 完整变更：[`' + previous + '...' + tag + '`](https://github.com/' + repo + '/compare/' + previous + '...' + tag + ')');
}
out.push('');
out.push('## 更新详情');
out.push('');
out.push(section || '（CHANGELOG 里没有找到对应版本的小节）');
out.push('');
const groups = collectArtifacts();
if (groups.length > 0) {
  out.push('## 安装包');
  out.push('');
  out.push('| 平台 | 文件 | 大小 |');
  out.push('|---|---|---|');
  for (const group of groups) {
    for (const file of group.files) {
      out.push('| ' + group.platform + ' | `' + file.name + '` | ' + (file.bytes / 1024 / 1024).toFixed(1) + ' MB |');
    }
  }
  out.push('');
}
out.push('## 安装与升级');
out.push('');
out.push('- **Windows**：安装包未签名，SmartScreen 会提示「未知发布者」，选「更多信息」→「仍要运行」。需要 Windows 10 及以上、x64。');
out.push('- **macOS**：未签名也未公证，首次打开需右键「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/PLManager.app`。');
out.push('- **Linux**：AppImage 先 `chmod +x` 再运行；deb 用 `sudo dpkg -i` 安装。');
out.push('- **数据**：库与备份在你的用户目录下（`~/.plmanager/data/`，Windows 同理），安装、更新、卸载都不会碰到它。1.0.0 及更早的版本把库放在安装目录的 `data/` 下，升级后要手动搬过来。首次启动（或结构有变更时）会自动执行数据库迁移，**执行前先把整库备份到 `data/backups/`**，保留最近 3 份。');
out.push('- **升级**：直接装新版本即可，无需先卸载。');
out.push('');
out.push('---');
out.push('');
out.push('本说明由 `scripts/release-notes.mjs` 生成；版本号取自 `package.json`，更新详情取自 `CHANGELOG.md`。');

console.log(out.join('\n'));
