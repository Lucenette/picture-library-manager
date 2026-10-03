import type { SortProfile } from './profile';
import { digitsScript } from './scripts/digits';
import { hanScript } from './scripts/han';
import { latinScript } from './scripts/latin';
import { otherScript } from './scripts/other';
import { symbolsScript } from './scripts/symbols';

/**
 * 一种文字（或字符类）的排序实现。要支持新文字就新增一个模块并插进 `SORT_SCRIPTS`，
 * 编排方、数据列与重建流程都不用动。
 */
export interface SortScript {
  /** 组前缀（`1|`…`5|`），决定这一段整体排在哪一组 */
  readonly group: string;
  /** 这个字符归不归我管；注册表按顺序问，第一个回答 true 的胜出 */
  matches(char: string): boolean;
  /** 把这一段变成可比较的正文 */
  encode(text: string, profile: SortProfile): string;
}

/** 注册表：顺序即优先级，兜底的 `other` 必须留在最后 */
export const SORT_SCRIPTS: readonly SortScript[] = [symbolsScript, digitsScript, hanScript, latinScript, otherScript];
