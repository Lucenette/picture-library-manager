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

/** 一个可排序字段：存原文的列、存派生排序键的列，以及算键时用的读音策略 */
export interface SortKeyField {
  readonly textColumn: string;
  readonly sortColumn: string;
  readonly profile: SortProfile;
}

/** 一张表上的全部排序键列 */
export interface SortKeyTable {
  readonly table: string;
  readonly fields: readonly SortKeyField[];
}

/**
 * 全部可排序字段。
 *
 * 升级回填、整表重建与建索引三处都以它为准：新增一个可排序字段就在这里加一行，
 * 顺带在 changelog 里加一列。写入点（`database/db.ts`）按各自的 SQL 传参，不读这张表。
 */
export const SORT_KEY_TABLES: readonly SortKeyTable[] = [
  {
    table: 'source',
    fields: [
      { textColumn: 'name', sortColumn: 'name_sort', profile: DEFAULT_PROFILE },
      { textColumn: 'root_path', sortColumn: 'root_path_sort', profile: DEFAULT_PROFILE },
    ],
  },
  {
    table: 'character',
    fields: [{ textColumn: 'name', sortColumn: 'name_sort', profile: CHARACTER_NAME_PROFILE }],
  },
  {
    table: 'image_group',
    fields: [
      { textColumn: 'dir_name', sortColumn: 'dir_name_sort', profile: DEFAULT_PROFILE },
      { textColumn: 'dir_path', sortColumn: 'dir_path_sort', profile: DEFAULT_PROFILE },
    ],
  },
  {
    table: 'image_file',
    fields: [{ textColumn: 'file_name', sortColumn: 'file_name_sort', profile: DEFAULT_PROFILE }],
  },
  {
    table: 'process_script',
    fields: [{ textColumn: 'name', sortColumn: 'name_sort', profile: DEFAULT_PROFILE }],
  },
  {
    table: 'processed_image',
    fields: [{ textColumn: 'script_name', sortColumn: 'script_name_sort', profile: DEFAULT_PROFILE }],
  },
];

