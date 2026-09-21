import type { SimilarData, SimilarGroup, SimilarMember } from '@common/types';

/**
 * 感知哈希的比对与分组。
 *
 * 数据来自第四页签（每个图片组选定的那一张）。每张图在扫描时已经算好感知哈希，
 * 这里只比哈希、不碰原图——一张 8 字节，一万张两两比也是秒级，而且图库盘离线
 * 也照样能识别。
 *
 * 分两层是因为汉明距离**不满足传递性**：A 与 B 差 3、B 与 C 差 3，A 与 C 可能
 * 差 6。所以先把距离 ≤ {@link SAME_DISTANCE} 的连成「相同组」，再把每个相同组
 * 当成一个节点、按 ≤ {@link SIMILAR_DISTANCE} 连成「相似组」。
 */

/** 判定「相同」的距离上限：重压缩、换分辨率通常只差一两位，换裁切会差很多 */
export const SAME_DISTANCE = 3;

/** 判定「相似」的距离上限 */
export const SIMILAR_DISTANCE = 10;

/** 每比较这么多轮就让出一次事件循环，避免长循环把主线程占死 */
const YIELD_EVERY = 4096;

/** 参与比对的一张图；phash 为 null 表示这张还没算过哈希 */
export interface SimilarInputRow {
  filePath: string;
  fileName: string;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  phash: Uint8Array | null;
}

/** 每个字节里 1 的个数，用来算汉明距离 */
const POPCOUNT = buildPopcounts();

/** 算出相同组与相似组；输入里没有哈希的图计入 skipped */
export async function buildSimilarGroups(rows: SimilarInputRow[]): Promise<SimilarData> {
  const usable = rows.filter((row) => row.phash !== null && row.phash.length > 0);
  const hashes = usable.map((row) => row.phash as Uint8Array);

  const sameParent = usable.map((_, index) => index);
  const sameClusters = (await groupIndices(usable.length, SAME_DISTANCE, hashes, sameParent)).filter(
    (cluster) => cluster.length > 1,
  );
  const same: SimilarGroup[] = sameClusters.map((cluster) => toGroup('same', cluster, usable, hashes));

  // 第二层：把每个「相同组」当成一个节点，节点间距取两组之间的最小距离
  const nodeParent = usable.map((_, index) => index);
  const nodeCount = sameClusters.length;
  let comparedNodes = 0;
  for (let left = 0; left < nodeCount; left += 1) {
    for (let right = left + 1; right < nodeCount; right += 1) {
      if (minDistance(sameClusters[left], sameClusters[right], hashes) <= SIMILAR_DISTANCE) {
        union(nodeParent, left, right);
      }
      comparedNodes += 1;
      if (comparedNodes % YIELD_EVERY === 0) {
        await yieldToEventLoop();
      }
    }
  }

  const similar: SimilarGroup[] = [];
  for (const nodes of await groupIndices(nodeCount, 0, [], nodeParent)) {
    if (nodes.length < 2) {
      continue;
    }
    const members = nodes.flatMap((node) => sameClusters[node]).sort((left, right) => left - right);
    similar.push(toGroup('similar', members, usable, hashes));
  }

  return { same, similar, compared: usable.length, skipped: rows.length - usable.length };
}

/** 用并查集把距离 ≤ limit 的下标连起来，并按连通分量分组 */
async function groupIndices(
  count: number,
  limit: number,
  hashes: Uint8Array[],
  parent: number[],
): Promise<number[][]> {
  if (hashes.length > 0) {
    let compared = 0;
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        if (hashDistance(hashes[left], hashes[right]) <= limit) {
          union(parent, left, right);
        }
        compared += 1;
        if (compared % YIELD_EVERY === 0) {
          await yieldToEventLoop();
        }
      }
    }
  }

  const buckets = new Map<number, number[]>();
  for (let index = 0; index < count; index += 1) {
    const root = find(parent, index);
    const bucket = buckets.get(root);
    if (bucket) {
      bucket.push(index);
    } else {
      buckets.set(root, [index]);
    }
  }
  return [...buckets.values()];
}

/** 把一组下标变成展示用的组；锚点取最小的那张，距离都相对它算 */
function toGroup(
  kind: 'same' | 'similar',
  indices: number[],
  rows: SimilarInputRow[],
  hashes: Uint8Array[],
): SimilarGroup {
  const anchor = indices[0];
  const members: SimilarMember[] = indices.map((index) => ({
    filePath: rows[index].filePath,
    fileName: rows[index].fileName,
    thumbnail: rows[index].thumbnail,
    width: rows[index].width,
    height: rows[index].height,
    distance: index === anchor ? 0 : hashDistance(hashes[anchor], hashes[index]),
  }));
  return { kind, members };
}

/** 两组之间的最小距离 */
function minDistance(left: number[], right: number[], hashes: Uint8Array[]): number {
  let smallest = Number.MAX_SAFE_INTEGER;
  for (const one of left) {
    for (const other of right) {
      const distance = hashDistance(hashes[one], hashes[other]);
      if (distance < smallest) {
        smallest = distance;
      }
    }
  }
  return smallest;
}

/** 查根，带路径压缩 */
function find(parent: number[], index: number): number {
  let root = index;
  while (parent[root] !== root) {
    root = parent[root];
  }
  let current = index;
  while (parent[current] !== root) {
    const next = parent[current];
    parent[current] = root;
    current = next;
  }
  return root;
}

/** 合并两个集合 */
function union(parent: number[], left: number, right: number): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) {
    parent[rightRoot] = leftRoot;
  }
}

/** 两个哈希的汉明距离；超过 {@link SIMILAR_DISTANCE} 立刻返回，短路掉大量比较 */
function hashDistance(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  let different = 0;
  for (let index = 0; index < length; index += 1) {
    different += POPCOUNT[left[index] ^ right[index]];
    if (different > SIMILAR_DISTANCE) {
      return different;
    }
  }
  return different;
}

/** 让出一次事件循环，保证主进程仍能处理窗口消息 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 预计算 256 个字节值的 popcount */
function buildPopcounts(): Uint8Array {
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    let bits = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & (1 << bit)) !== 0) {
        bits += 1;
      }
    }
    table[value] = bits;
  }
  return table;
}
