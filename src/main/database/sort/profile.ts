/**
 * 排序键的读音策略：同一个字在不同语义下读音不同（人名要按姓氏读），
 * 所以策略由调用方按字段挑，规则本身不猜字段。
 */
export type HanReading = 'default' | 'surname';

/** 排序键的读音策略 */
export interface SortProfile {
  /** 汉字的读音取法 */
  readonly han: HanReading;
}

/** 常规读音：来源名、目录名、文件名、脚本名 */
export const DEFAULT_PROFILE: SortProfile = { han: 'default' };

/** 姓氏读音：角色名（`单田芳` 读 shan 而不是 dan） */
export const CHARACTER_NAME_PROFILE: SortProfile = { han: 'surname' };
