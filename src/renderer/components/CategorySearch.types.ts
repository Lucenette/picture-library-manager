/** 筛选下拉中的一个候选项 */
export interface FilterItem {
  label: string;
  value: string;
}

/** 一个筛选维度及其当前状态 */
export interface FilterSection {
  key: string;
  label: string;
  /** 已选值，空串表示该维度未启用 */
  value: string;
  /** 标签上展示的文本 */
  display: string;
  /** 候选项；为空表示该维度由用户自由输入 */
  items: FilterItem[];
  onSelect: (value: string) => void;
  onClear: () => void;
}
