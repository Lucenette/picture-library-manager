/**
 * 生成 Release 说明：提交信息、更新详情（取自 CHANGELOG）、各平台产物、安装与升级提示。
 *
 * 「更新详情」是**上次发布（最近一个 tag）以来的全部小节**，不是只有发布号那一节：中间那些没发布的
 * 版本（跳过的 z 补丁、只落到 master 而没打 tag 的版本）会一并带上；多节时按版本分块、节内标题降一级。
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

/** 把 CHANGELOG 拆成有序小节；顺序与文件一致（新的在前），链接定义不算正文 */
function changelogSections(text) {
  const lines = text.split('\n');
  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^## \[([^\]]+)\]/.exec(lines[i]);
    if (heading === null) {
      continue;
    }
    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.startsWith('## ') || /^\[/.test(line)) {
        break;
      }
      body.push(line);
    }
    sections.push({ version: heading[1], body: body.join('\n').trim() });
  }
  return sections;
}

/** 只比 x.y.z 三段；非版本号（`未发布`）按「更新」处理，返回 1 */
function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(left);
  const b = parse(right);
  if (a === null || b === null) {
    return 1;
  }
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/**
 * 上次发布以来的小节。
 *
 * 上次发布 = 最近一个 tag：取它对应那一节**上面**的全部小节（文件是新的在前）。找不到那一节时退回按
 * 版本号比较；连 tag 都没有（首次发布，或环境里没有 git）就全部带上——宁可多带，不能漏掉没发布过的版本。
 * 空小节（例如刚定稿后补回的 `[未发布]`）不进结果。
 */
function sectionsSinceLastRelease(sections, previousTag) {
  const usable = sections.filter((section) => section.body !== '');
  const previous = previousTag.replace(/^v/, '');
  if (previous === '') {
    return usable;
  }
  const index = usable.findIndex((section) => section.version === previous);
  if (index >= 0) {
    return usable.slice(0, index);
  }
  return usable.filter((section) => compareVersions(section.version, previous) > 0);
}

/** 拼成「更新详情」的正文：只有一节原样输出；多节按版本分块、节内标题降一级 */
function formatSections(sections) {
  if (sections.length <= 1) {
    return sections[0]?.body ?? '';
  }
  return sections
    .map((section) => `### [${section.version}]\n\n${section.body.replace(/^### /gm, '#### ')}`)
    .join('\n\n');
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
const sections = sectionsSinceLastRelease(changelogSections(changelog), previous);

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
out.push(formatSections(sections) || '（CHANGELOG 里没有找到上次发布以来的条目）');
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