/**
 * 脚本正文的一处改动：比的是「现在这份正文」与磁盘上那一版。
 *
 * 行号是当前正文里的 1-based 行号，与 Monaco 一致；纯删除在当前正文里没有对应行，所以记
 * 「删除处开始的那一行」（界面在它上沿画个小三角）。
 */
export interface ScriptLineChange {
  startLineNumber: number;
  endLineNumber: number;
  kind: 'added' | 'modified' | 'deleted';
}

/**
 * 差异规模上限：Myers 是 O((N+M)·D)，D 大时会退化成平方级，所以给个上限。
 *
 * 超过就当作「中间整段都改了」。上限按「别卡住编辑器」定：实测 3000 行隔行改写
 * （D≈3000）时上限 2000 要 75ms、上限 500 要 14ms；脚本通常几百行，真差 500 行以上时
 * 逐行对齐也没人看。
 */
const MAX_EDIT_DISTANCE = 500;

/** 逐行的编辑动作 */
type Edit = 'equal' | 'insert' | 'delete';

/**
 * 行级差异：算出「现在这份正文」相对旧正文改了哪些行。
 *
 * 用 Myers 的贪心算法（git diff / diff-match-patch 用的同一个），只是按**行**而不是按字符跑：
 * 先剪掉公共前后缀（日常编辑只剩中间一小段），剩下的求 O((N+M)·D) 的最短编辑脚本，再归并成区间。
 * 行号是「现在这份正文」里的 1-based 行号，与 Monaco 一致（末尾换行也算一行）。
 */
export function diffLineChanges(before: string, after: string): ScriptLineChange[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  let prefix = 0;
  while (
    prefix < beforeLines.length
    && prefix < afterLines.length
    && beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midBefore = beforeLines.slice(prefix, beforeLines.length - suffix);
  const midAfter = afterLines.slice(prefix, afterLines.length - suffix);
  if (midBefore.length === 0 && midAfter.length === 0) {
    return [];
  }

  // 快速通道：两边都有内容却一行都不相同（整篇换个写法）时 LCS 为 0，不必让 Myers 跑到上限。
  // 单侧为空是纯增/纯删，Myers 一眼就到底，不能走这里——那会把 added 说成 modified。
  if (midBefore.length > 0 && midAfter.length > 0 && !sharesAnyLine(midBefore, midAfter)) {
    return [{ startLineNumber: prefix + 1, endLineNumber: prefix + midAfter.length, kind: 'modified' }];
  }

  const edits = myersEdits(midBefore, midAfter);
  if (edits === null) {
    return [{ startLineNumber: prefix + 1, endLineNumber: prefix + midAfter.length, kind: 'modified' }];
  }

  return toChanges(edits, prefix, afterLines.length);
}

/** 两段之间有没有完全相同的行 */
function sharesAnyLine(before: string[], after: string[]): boolean {
  const seen = new Set(before);
  for (const line of after) {
    if (seen.has(line)) {
      return true;
    }
  }
  return false;
}

/**
 * 逐行的最短编辑脚本；差异超过 {@link MAX_EDIT_DISTANCE} 时返回 null。
 *
 * V 数组按对角线 k = x - y 记录每轮能到达的最远 x；trace 存下「进入第 d 轮之前」的 V，
 * 回溯时要用同一份 V 重新判断当时是从哪条对角线过来的。
 */
function myersEdits(before: string[], after: string[]): Edit[] | null {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    if (d > MAX_EDIT_DISTANCE) {
      return null;
    }
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, before, after, d, offset);
      }
    }
  }

  return null;
}

/** 从 trace 回退出动作序列，顺序与正文一致（从旧正文开头到结尾） */
function backtrack(trace: Int32Array[], before: string[], after: string[], distance: number, offset: number): Edit[] {
  const edits: Edit[] = [];
  let x = before.length;
  let y = after.length;

  for (let depth = distance; depth > 0; depth -= 1) {
    const v = trace[depth];
    const k = x - y;
    let prevK: number;
    if (k === -depth || (k !== depth && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      edits.push('equal');
      x -= 1;
      y -= 1;
    }
    if (x > prevX) {
      edits.push('delete');
      x -= 1;
    } else {
      edits.push('insert');
      y -= 1;
    }
  }

  while (x > 0 && y > 0) {
    edits.push('equal');
    x -= 1;
    y -= 1;
  }

  edits.reverse();
  return edits;
}

/**
 * 把动作序列归并成区间：增+删相邻算「修改」，只有增算「新增」，只有删算一个删除位置。
 *
 * 纯删除在新正文里没有对应的行，所以记「删除处开始的那一行」（界面在它上沿画个小三角）；
 * 删在末尾时退回最后一行。
 */
function toChanges(edits: Edit[], prefix: number, totalAfter: number): ScriptLineChange[] {
  const changes: ScriptLineChange[] = [];
  let line = prefix;
  let index = 0;

  while (index < edits.length) {
    if (edits[index] === 'equal') {
      line += 1;
      index += 1;
      continue;
    }

    const start = line;
    let inserted = 0;
    let deleted = 0;
    while (index < edits.length && edits[index] !== 'equal') {
      if (edits[index] === 'insert') {
        line += 1;
        inserted += 1;
      } else {
        deleted += 1;
      }
      index += 1;
    }

    if (inserted > 0 && deleted > 0) {
      changes.push({ startLineNumber: start + 1, endLineNumber: start + inserted, kind: 'modified' });
    } else if (inserted > 0) {
      changes.push({ startLineNumber: start + 1, endLineNumber: start + inserted, kind: 'added' });
    } else {
      const at = Math.min(Math.max(1, start + 1), Math.max(1, totalAfter));
      changes.push({ startLineNumber: at, endLineNumber: at, kind: 'deleted' });
    }
  }

  return changes;
}
