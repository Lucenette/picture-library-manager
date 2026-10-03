#!/usr/bin/env node

/**
 * 代码量统计：按扩展名、目录与单文件统计行数，并把代码行分成代码 / 注释 / 空行。
 *
 * 零依赖，直接运行：
 *   node .agents/skills/code-metrics/scripts/count-lines.mjs
 *   node .agents/skills/code-metrics/scripts/count-lines.mjs --json
 *   node .agents/skills/code-metrics/scripts/count-lines.mjs --top 20 --depth 2
 *
 * 只读，不修改任何文件。默认从仓库根开始遍历，跳过 `.git` / `node_modules` / `dist` / `out` 等目录；
 * 二进制文件（前 8000 字节含 NUL）直接跳过，不参与统计。
 *
 * **代码的判定**：`src/` 下的一切（二进制除外）都算代码，不论扩展名；`src/` 之外按扩展名判断。
 * 因此 `src/main/ups/changesets/<版本>/dbups.xml`（建表 SQL 的版本化正文）计入代码。
 *
 * 注释判定是**行首启发式**：整行 trim 后以 `//`、`/*`、`*`、`*\/`、`<!--` 开头才算注释行，
 * 行尾注释放进代码行。误差量级见 references/interpretation.md 的「已知局限」。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

/** 从脚本位置推导仓库根：`.agents/skills/code-metrics/scripts/` 往上四级。 */
const REPO_ROOT = resolve(import.meta.dirname, '../../../../');

/** 遍历时跳过的目录名。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', '.idea', '.vscode', 'coverage', '.cache']);

/** 默认参与「代码 / 注释 / 空行」拆分的扩展名。 */
const DEFAULT_SOURCE_EXTS = ['.ts', '.vue', '.js', '.mjs', '.cjs', '.css', '.html'];

/** 这些目录下的一切（二进制除外）都算代码，不论扩展名——`src/main/ups/changesets/<版本>/dbups.xml` 是建表 SQL 的版本化正文，属于代码。 */
const DEFAULT_CODE_DIRS = ['src'];

/** 代码目录的绝对路径：与遍历到的文件做包含判断，因此不受 --root 影响。 */
const CODE_DIR_ABS = DEFAULT_CODE_DIRS.map((dir) => resolve(REPO_ROOT, dir));

/** 整行注释的行首标志。 */
const COMMENT_PREFIX = /^(?:\/\/|\/\*|\*|\*\/|<!--)/;

/** 判定二进制时嗅探的字节数。 */
const SNIFF_BYTES = 8000;

/** 文件行数分布的分档上界，最后一档是「大于前一档」。 */
const SIZE_BUCKETS = [50, 100, 200, 300, 400, 500];

const HELP = `代码量统计（零依赖，只读）

用法：node .agents/skills/code-metrics/scripts/count-lines.mjs [选项]

  --root <目录>     统计根，默认仓库根
  --ext <列表>      覆盖 src/ 之外判为代码的扩展名，例如 --ext .ts,.vue
  --top <n>         单文件排行取前 n 名，默认 15
  --depth <n>       目录聚合深度，默认 3
  --json            输出 JSON 而不是文字报告
  -h, --help        显示本帮助

代码 = src/ 下的一切（不论扩展名）+ src/ 之外扩展名命中 --ext 的文件。

退出码：0 表示统计完成，1 表示参数错误。`;

/**
 * 解析命令行参数。
 * @param {string[]} argv 去掉 node 与脚本名之后的参数
 * @returns {{root: string, exts: string[], top: number, depth: number, json: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    exts: [...DEFAULT_SOURCE_EXTS],
    top: 15,
    depth: 3,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--root' || arg === '--ext' || arg === '--top' || arg === '--depth') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`${arg} 缺少取值`);
      }
      i += 1;
      if (arg === '--root') {
        options.root = resolve(value);
      } else if (arg === '--ext') {
        options.exts = value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '')
          .map((item) => (item.startsWith('.') ? item : `.${item}`));
      } else if (arg === '--top') {
        options.top = Number.parseInt(value, 10);
      } else {
        options.depth = Number.parseInt(value, 10);
      }
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!Number.isInteger(options.top) || options.top < 1) {
    throw new Error('--top 必须是正整数');
  }
  if (!Number.isInteger(options.depth) || options.depth < 1) {
    throw new Error('--depth 必须是正整数');
  }
  return options;
}

/**
 * 递归收集文件绝对路径，跳过 SKIP_DIRS。
 * @param {string} dir 目录绝对路径
 * @param {string[]} out 收集结果
 */
function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(join(dir, entry.name), out);
      }
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
}

/**
 * 前 SNIFF_BYTES 字节里出现 NUL 即视为二进制。
 * @param {Buffer} buf 文件内容
 * @returns {boolean} 是否是二进制
 */
function isBinary(buf) {
  const limit = Math.min(buf.length, SNIFF_BYTES);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * 统计单个文件的行数构成。读不到的文件（权限、竞态的删除）返回 null，由调用方跳过。
 * @param {string} absPath 文件绝对路径
 * @returns {{total: number, blank: number, comment: number, code: number} | null} 二进制或读不到的文件返回 null
 */
function analyze(absPath) {
  let buf;
  try {
    buf = readFileSync(absPath);
  } catch {
    return null;
  }
  if (isBinary(buf)) {
    return null;
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const lines = text.split(/\r?\n/);
  // 文件以换行结尾时 split 会多出一个空串，它不是一行，去掉后与 wc -l / Get-Content 同口径。
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  let blank = 0;
  let comment = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      blank += 1;
    } else if (COMMENT_PREFIX.test(trimmed)) {
      comment += 1;
    }
  }
  return { total: lines.length, blank, comment, code: lines.length - blank - comment };
}

/**
 * 某路径归属的目录键，按 depth 截断。
 * @param {string} relPath 相对统计根的路径（以 / 分隔）
 * @param {number} depth 聚合深度
 * @returns {string} 目录键
 */
function dirKey(relPath, depth) {
  const parts = relPath.split('/');
  if (parts.length <= 1) {
    return '(root)';
  }
  return parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
}

/**
 * 字符串显示宽度：CJK 与全角字符按 2 列算，用于表格对齐。
 * @param {string} text 待测量文本
 * @returns {number} 显示宽度
 */
function displayWidth(text) {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * 把行数组渲染成对齐的文本表格。
 * @param {string[]} headers 表头
 * @param {Array<Array<string|number>>} rows 数据行
 * @returns {string[]} 表格的每一行
 */
function renderTable(headers, rows) {
  const matrix = [headers, ...rows].map((row) => row.map((cell) => String(cell)));
  const widths = headers.map((_, column) =>
    Math.max(...matrix.map((row) => displayWidth(row[column]))),
  );
  return matrix.map((row) =>
    row
      .map((cell, column) => {
        const fill = ' '.repeat(widths[column] - displayWidth(cell));
        return column === 0 ? cell + fill : fill + cell;
      })
      .join('  ')
      .trimEnd(),
  );
}

/**
 * 累加一组统计对象。
 * @param {Array<{total: number, blank: number, comment: number, code: number}>} items 统计对象
 * @returns {{files: number, total: number, blank: number, comment: number, code: number}} 合计
 */
function sumOf(items) {
  return items.reduce(
    (acc, item) => ({
      files: acc.files + 1,
      total: acc.total + item.total,
      blank: acc.blank + item.blank,
      comment: acc.comment + item.comment,
      code: acc.code + item.code,
    }),
    { files: 0, total: 0, blank: 0, comment: 0, code: 0 },
  );
}

/** 主流程：遍历、统计、输出。 */
function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`参数错误：${error.message}\n\n${HELP}`);
    process.exit(1);
  }
  if (options.help) {
    console.log(HELP);
    return;
  }

  const files = [];
  walk(options.root, files);
  files.sort();

  const sourceExts = new Set(options.exts);
  const sourceFiles = [];
  const otherExts = new Map();

  for (const absPath of files) {
    const stats = analyze(absPath);
    if (stats === null) {
      continue;
    }
    const relPath = relative(options.root, absPath).split('\\').join('/');
    const ext = extname(absPath).toLowerCase() || '(无扩展名)';
    const inCodeDir = CODE_DIR_ABS.some((dir) => absPath === dir || absPath.startsWith(dir + sep));
    if (inCodeDir || sourceExts.has(ext)) {
      sourceFiles.push({ relPath, ext, ...stats });
    } else {
      const bucket = otherExts.get(ext) ?? { files: 0, total: 0, blank: 0 };
      bucket.files += 1;
      bucket.total += stats.total;
      bucket.blank += stats.blank;
      otherExts.set(ext, bucket);
    }
  }

  const byExt = new Map();
  const byDir = new Map();
  for (const file of sourceFiles) {
    const extBucket = byExt.get(file.ext) ?? [];
    extBucket.push(file);
    byExt.set(file.ext, extBucket);
    const key = dirKey(file.relPath, options.depth);
    const dirBucket = byDir.get(key) ?? [];
    dirBucket.push(file);
    byDir.set(key, dirBucket);
  }

  const totals = sumOf(sourceFiles);
  const distribution = new Map();
  for (const file of sourceFiles) {
    const upper = SIZE_BUCKETS.find((limit) => file.total <= limit);
    const label = upper === undefined
      ? `>${SIZE_BUCKETS[SIZE_BUCKETS.length - 1]}`
      : file.total <= SIZE_BUCKETS[0]
        ? `<=${SIZE_BUCKETS[0]}`
        : `${SIZE_BUCKETS[SIZE_BUCKETS.indexOf(upper) - 1] + 1}-${upper}`;
    distribution.set(label, (distribution.get(label) ?? 0) + 1);
  }

  const topFiles = [...sourceFiles].sort((a, b) => b.total - a.total).slice(0, options.top);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          root: options.root,
          sourceExts: options.exts,
          source: {
            ...totals,
            averageLinesPerFile: totals.files === 0 ? 0 : Number((totals.total / totals.files).toFixed(1)),
            byExt: [...byExt.entries()]
              .map(([ext, items]) => ({ ext, ...sumOf(items) }))
              .sort((a, b) => b.code - a.code),
            byDir: [...byDir.entries()]
              .map(([dir, items]) => ({ dir, ...sumOf(items) }))
              .sort((a, b) => b.code - a.code),
            topFiles: topFiles.map((file) => ({
              file: file.relPath,
              total: file.total,
              code: file.code,
              comment: file.comment,
              blank: file.blank,
            })),
            distribution: [...distribution.entries()].map(([range, count]) => ({ range, count })),
          },
          other: [...otherExts.entries()]
            .map(([ext, item]) => ({ ext, ...item }))
            .sort((a, b) => b.total - a.total),
        },
        null,
        2,
      ),
    );
    return;
  }

  const out = [];
  out.push(`代码量统计：${options.root}`);
  out.push('');
  out.push(`== 代码（${DEFAULT_CODE_DIRS.join(' / ')} 下全部 + 扩展名 ${options.exts.join(' ')}）==`);
  out.push(...renderTable(
    ['文件数', '总行数', '代码行', '注释行', '空行', '平均行/文件'],
    [[totals.files, totals.total, totals.code, totals.comment, totals.blank, (totals.files === 0 ? 0 : (totals.total / totals.files).toFixed(1))]],
  ));
  out.push('');
  out.push('-- 按扩展名 --');
  out.push(...renderTable(
    ['扩展名', '文件数', '总行数', '代码行', '注释行', '空行'],
    [...byExt.entries()]
      .map(([ext, items]) => ({ ext, ...sumOf(items) }))
      .sort((a, b) => b.code - a.code)
      .map((item) => [item.ext, item.files, item.total, item.code, item.comment, item.blank]),
  ));
  out.push('');
  out.push(`-- 按目录（深度 ${options.depth}） --`);
  out.push(...renderTable(
    ['目录', '文件数', '总行数', '代码行', '注释行'],
    [...byDir.entries()]
      .map(([dir, items]) => ({ dir, ...sumOf(items) }))
      .sort((a, b) => b.code - a.code)
      .map((item) => [item.dir, item.files, item.total, item.code, item.comment]),
  ));
  out.push('');
  out.push(`-- 单文件 Top ${options.top} --`);
  out.push(...renderTable(
    ['文件', '总行数', '代码行', '注释行'],
    topFiles.map((file) => [file.relPath, file.total, file.code, file.comment]),
  ));
  out.push('');
  out.push('-- 文件行数分布 --');
  out.push(...renderTable(
    ['区间', '文件数'],
    SIZE_BUCKETS.map((limit, index) => {
      const label = index === 0 ? `<=${limit}` : `${SIZE_BUCKETS[index - 1] + 1}-${limit}`;
      return [label, distribution.get(label) ?? 0];
    }).concat([[`>${SIZE_BUCKETS[SIZE_BUCKETS.length - 1]}`, distribution.get(`>${SIZE_BUCKETS[SIZE_BUCKETS.length - 1]}`) ?? 0]]),
  ));
  out.push('');
  out.push('== 其他类型（非代码，只统计行数）==');
  out.push(...renderTable(
    ['扩展名', '文件数', '总行数'],
    [...otherExts.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([ext, item]) => [ext, item.files, item.total]),
  ));
  out.push('');
  out.push('注：代码 = src/ 下的一切（不论扩展名）+ 上述扩展名；代码 / 注释 / 空行按行首启发式拆分，行尾注释计入代码行；二进制文件与 .git / node_modules / dist / out 等目录不参与统计。');
  console.log(out.join('\n'));
}

main();
