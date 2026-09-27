import type { ScriptType } from '@common/types';

/** 类型标签与脚本页一直用的那套中文名 */
export const TYPE_LABELS: Record<ScriptType, string> = {
  'select-image': '图片',
  'identify-character': '角色',
  'identify-structure': '结构',
};

/**
 * 左栏一行。
 *
 * 库里的脚本与新建未保存的草稿都投影成它：草稿的类型是未知的（草稿文件只存名字与正文，
 * 类型关联永远描述磁盘上那一版），所以是空数组，界面据此让它不受类型过滤影响。
 */
export interface SideItem {
  key: string;
  name: string;
  state: 'new' | 'modified' | 'clean';
  types: ScriptType[];
  /** 内置脚本：右键菜单里给它「恢复默认」而不是「删除」 */
  builtin: boolean;
}

/** 左栏右键菜单里的动作 */
export type SideAction = 'rename' | 'discard' | 'reset' | 'remove';
