/**
 * 文档与 skill 的静态检查。
 *
 * 检查五件事：
 *   1. 参与的文本文件都是不带 BOM 的合法 UTF-8（Markdown 与 changelog XML）；
 *   2. Markdown 里的相对链接目标存在，锚点能命中标题或显式 `<a id>`；
 *   3. docs/roadmap 与 docs/design 的 README 索引与实际文件双向一致；
 *   4. .agents/skills/<name>/SKILL.md 的 frontmatter 合法；
 *   5. 没有占位符残留（`«` / `»`，以及尖括号里的邮箱占位、TODO 一类词根）。
 *
 * 零依赖，直接运行：node scripts/check-docs.mjs
 * 通过时只打印一行；发现问题时逐条打印 `文件:行 说明` 并以退出码 1 结束。不修改任何文件。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
/** 参与检查的目录与根文件：只覆盖仓库自己写的文档，不含依赖与构建产物。 */
const SCAN_DIRS = ['docs', '.agents/skills'];
const SCAN_ROOT_FILES = ['AGENTS.md', 'README.md', 'CONTRIBUTING.md'];
/** 只校验编码、不参与链接与索引检查的目录：changelog 里有中文表名注释，存错编码会静默变成乱码写进账本。 */
const ENCODING_DIRS = ["src/main/ups/changesets"];
/** 这两个目录的 README 是索引表，必须与目录内的文件双向一致。 */
const INDEX_DIRS = ['docs/roadmap', 'docs/design'];
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDERS = ['«', '»'];
/**
 * 尖括号占位符的词根。中文词根写成 Unicode 转义，避免让「全仓搜不到占位词」的验证
 * 被这个检查脚本自己破坏；TODO 与 FIXME 也只在一对尖括号内才算命中。
 */
const PLACEHOLDER_ROOTS = ['\u5f85\u586b\u5199', '\u7ef4\u62a4\u8005\u90ae\u7bb1', 'TODO', 'FIXME'];
const PLACEHOLDER_ANGLE = new RegExp('<[^<>]*(?:' + PLACEHOLDER_ROOTS.join('|') + ')[^<>]*>', 'i');
/**
 * 临时豁免：该文件引用占位符示例来说明这条检查本身。开源就绪完成后它会按计划删除，
 * 届时连同这条豁免一起删掉。
 */
const PLACEHOLDER_EXEMPT_FILES = new Set(['docs/roadmap/open-source-readiness.md']);
/** 外部链接、协议相对、仓库根绝对路径与纯锚点都不做目标存在性检查。 */
const SKIP_TARGET = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

const violations = [];

/** 递归收集目录下的 Markdown，返回相对仓库根、以 / 分隔的路径。
 * @param {string} absDir 绝对目录
 * @param {string} relDir 相对仓库根的目录
 * @param {string[]} out 收集结果
 */
function walkMarkdown(absDir, relDir, out) {
  if (!existsSync(absDir)) {
    return;
  }
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      walkMarkdown(join(absDir, entry.name), rel, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
}

/** 收集全部待检查的 Markdown 文件名。 */
function collectMarkdown() {
  const files = SCAN_ROOT_FILES.filter((name) => existsSync(resolve(ROOT, name)));
  for (const dir of SCAN_DIRS) {
    walkMarkdown(resolve(ROOT, dir), dir, files);
  }
  return files.sort();
}

/** 把标题文本转成 GitHub 风格的锚点：转小写、去标点、空格转连字符，保留汉字。 */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** 标记每一行是否位于围栏代码块内，示例代码里的路径不参与检查。
 * @param {string[]} lines 文件各行
 * @returns {boolean[]} 与 lines 等长的标记
 */
function codeFenceFlags(lines) {
  const flags = [];
  let fence = null;
  for (const line of lines) {
    const match = /^\s*(```+|~~~+)/.exec(line);
    if (match !== null && (fence === null || match[1][0] === fence)) {
      fence = fence === null ? match[1][0] : null;
      flags.push(true);
      continue;
    }
    flags.push(fence !== null);
  }
  return flags;
}

/** 取一份文件的全部锚点：标题与显式 `<a id="...">`，跳过代码块。
 * @param {string[]} lines 文件各行
 * @param {boolean[]} fenced 围栏标记
 * @returns {Set<string>} 锚点集合
 */
function anchorsOf(lines, fenced) {
  const anchors = new Set();
  for (const [index, line] of lines.entries()) {
    if (fenced[index] === true) {
      continue;
    }
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      anchors.add(slugify(heading[1]));
    }
    for (const match of line.matchAll(/<a\s+id="([^"]+)"/g)) {
      anchors.add(slugify(match[1]));
    }
  }
  return anchors;
}

/** 读入一份文档的文本：必须是合法 UTF-8、不带 BOM、不含 NUL，并把行尾统一成 LF。
 * @param {string} rel 相对仓库根的路径
 * @returns {string | undefined} 文本；编码不合法时返回 undefined 并记录问题
 */
function readText(rel) {
  const buffer = readFileSync(resolve(ROOT, rel));
  let text;
  try {
    // fatal 让非法字节直接抛错，而不是替换成 U+FFFD —— 中文文档按 GBK 存盘时正是这种情况。
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    violations.push({
      file: rel,
      line: 1,
      message: "不是合法的 UTF-8（多半存成了 GBK/ANSI 或 UTF-16，请另存为 UTF-8）",
    });
    return undefined;
  }
  if (buffer.includes(0)) {
    violations.push({ file: rel, line: 1, message: "含 NUL 字节，不是文本文件" });
    return undefined;
  }
  // 必须看字节：TextDecoder 默认会把 BOM 从解码结果里去掉，用 text.startsWith 判永远不成立。
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    // provider 用精确比较识别 frontmatter，BOM 会让 skill 静默失效，所以不放过。
    violations.push({
      file: rel,
      line: 1,
      message: "带 UTF-8 BOM；BOM 会让 SKILL.md 的 frontmatter 识别失败，请另存为不带 BOM 的 UTF-8",
    });
  }
  // 行尾在这里统一成 LF：.gitattributes 是 text=auto，检出到各平台分别是 LF 或 CRLF，
  // 判定逻辑不该依赖具体是 LF、CRLF 还是 CR；结尾有没有换行、有几行空行都不影响。
  return text.replace(/\r\n?/g, "\n");
}

/** 读入全部文档并建立索引；编码不合法的文件已单独报错，跳过后续检查。 */
function loadSources() {
  const sources = new Map();
  for (const rel of collectMarkdown()) {
    const text = readText(rel);
    if (text === undefined) {
      continue;
    }
    const lines = text.split("\n");
    sources.set(rel, { lines, fenced: codeFenceFlags(lines) });
  }
  return sources;
}

/** 检查相对链接与锚点。
 * @param {Map<string, {lines: string[], fenced: boolean[]}>} sources 全部文档
 * @returns {number} 检查过的链接条数
 */
function checkLinks(sources) {
  const anchorCache = new Map();
  let linkCount = 0;
  const anchorsFor = (rel) => {
    if (!anchorCache.has(rel)) {
      anchorCache.set(rel, anchorsOf(sources.get(rel).lines, sources.get(rel).fenced));
    }
    return anchorCache.get(rel);
  };
  for (const [rel, source] of sources) {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    for (const [index, line] of source.lines.entries()) {
      if (source.fenced[index] === true) {
        continue;
      }
      for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
        const url = match[1];
        linkCount += 1;
        const hashAt = url.indexOf('#');
        const pathPart = hashAt < 0 ? url : url.slice(0, hashAt);
        const fragment = hashAt < 0 ? '' : url.slice(hashAt + 1);
        if (pathPart === '') {
          if (fragment !== "" && !anchorsFor(rel).has(slugify(fragment))) {
            violations.push({ file: rel, line: index + 1, message: `锚点不存在：#${fragment}` });
          }
          continue;
        }
        if (SKIP_TARGET.test(pathPart)) {
          continue;
        }
        const target = resolve(ROOT, dir, pathPart);
        if (!existsSync(target)) {
          violations.push({ file: rel, line: index + 1, message: `链接目标不存在：${pathPart}` });
          continue;
        }
        if (fragment === '' || !target.endsWith('.md')) {
          continue;
        }
        const targetRel = relative(ROOT, target).replaceAll('\\', '/');
        if (!sources.has(targetRel) || !anchorsFor(targetRel).has(slugify(fragment))) {
          violations.push({ file: rel, line: index + 1, message: `锚点不存在：${pathPart}#${fragment}` });
        }
      }
    }
  }
  return linkCount;
}

/** 递归收集目录下的 XML；changelog 现在按版本目录存放（ups/changesets/<版本>/dbups.xml） */
function walkXml(absDir, relDir, out) {
  if (!existsSync(absDir)) {
    return;
  }
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      walkXml(join(absDir, entry.name), rel, out);
    } else if (entry.isFile() && entry.name.endsWith(".xml")) {
      out.push(rel);
    }
  }
}

/** 校验只关心编码的目录（readText 内部报错，返回值丢弃）。 */
function checkEncodings() {
  const files = [];
  for (const dir of ENCODING_DIRS) {
    walkXml(resolve(ROOT, dir), dir, files);
  }
  for (const rel of files) {
    readText(rel);
  }
}

/** 检查索引表与实际文件是否双向一致。
 * @param {Map<string, {lines: string[], fenced: boolean[]}>} sources 全部文档
 */
function checkIndexes(sources) {
  for (const dir of INDEX_DIRS) {
    const readme = `${dir}/README.md`;
    const source = sources.get(readme);
    if (source === undefined) {
      violations.push({ file: readme, line: 1, message: "索引文件不存在" });
      continue;
    }
    const listed = new Set([...source.lines.join('\n').matchAll(/\]\(\.\/([^)\s]+?\.md)\)/g)].map((m) => m[1]));
    const actual = new Set(
      readdirSync(resolve(ROOT, dir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
        .map((entry) => entry.name),
    );
    for (const name of actual) {
      if (!listed.has(name)) {
        violations.push({ file: readme, line: 1, message: `索引漏登记：${name}` });
      }
    }
    for (const name of listed) {
      if (!actual.has(name)) {
        violations.push({ file: readme, line: 1, message: `索引登记了不存在的文件：${name}` });
      }
    }
  }
}

/** 检查 skill 的 frontmatter。
 * @param {Map<string, {lines: string[], fenced: boolean[]}>} sources 全部文档
 */
function checkSkills(sources) {
  const skillsRoot = resolve(ROOT, '.agents/skills');
  if (!existsSync(skillsRoot)) {
    return;
  }
  const names = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const rel = `.agents/skills/${name}/SKILL.md`;
    const source = sources.get(rel);
    if (source === undefined) {
      violations.push({ file: `.agents/skills/${name}`, line: 1, message: "目录下没有 SKILL.md" });
      continue;
    }
    // 分隔符必须独占一行且精确为 ---：多一个空格 provider 就认不出 frontmatter，skill 会静默失效。
    if (source.lines[0] !== '---') {
      violations.push({
        file: rel,
        line: 1,
        message: source.lines[0].trimEnd() === '---' ? 'frontmatter 起始行在 --- 之后有多余字符' : 'frontmatter 必须以 --- 开头',
      });
      continue;
    }
    const end = source.lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
    if (end < 0) {
      violations.push({ file: rel, line: 1, message: 'frontmatter 没有闭合的 ---' });
      continue;
    }
    if (source.lines[end] !== '---') {
      violations.push({ file: rel, line: end + 1, message: 'frontmatter 闭合行在 --- 之后有多余字符' });
      continue;
    }
    const fields = new Map();
    for (const line of source.lines.slice(1, end)) {
      const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (match !== null) {
        fields.set(match[1], match[2].trim());
      }
    }
    const declared = fields.get('name');
    if (declared === undefined || !SKILL_NAME.test(declared)) {
      violations.push({ file: rel, line: 2, message: "frontmatter 的 name 必须是 kebab-case" });
    } else if (declared !== name) {
      violations.push({ file: rel, line: 2, message: `frontmatter 的 name（${declared}）与目录名（${name}）不一致` });
    }
    if ((fields.get('description') ?? '') === '') {
      violations.push({ file: rel, line: 3, message: "frontmatter 缺少 description" });
    }
  }
}

/** 检查占位符残留。
 * @param {Map<string, {lines: string[], fenced: boolean[]}>} sources 全部文档
 */
function checkPlaceholders(sources) {
  for (const [rel, source] of sources) {
    if (PLACEHOLDER_EXEMPT_FILES.has(rel)) {
      continue;
    }
    for (const [index, line] of source.lines.entries()) {
      for (const token of PLACEHOLDERS) {
        if (line.includes(token)) {
          violations.push({ file: rel, line: index + 1, message: `占位符残留：${token}` });
        }
      }
      const match = PLACEHOLDER_ANGLE.exec(line);
      if (match !== null) {
        violations.push({ file: rel, line: index + 1, message: `占位符残留：${match[0]}` });
      }
    }
  }
}

const sources = loadSources();
checkEncodings();
const linkCount = checkLinks(sources);
checkIndexes(sources);
checkSkills(sources);
checkPlaceholders(sources);

if (violations.length > 0) {
  for (const violation of violations) {
    console.log(`${violation.file}:${violation.line} ${violation.message}`);
  }
  console.log(`文档检查失败：${violations.length} 个问题。`);
  process.exit(1);
}
console.log(`文档检查通过：${sources.size} 个文件，${linkCount} 条链接。`);
