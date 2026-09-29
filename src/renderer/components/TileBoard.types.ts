/** 平铺网格里的一张一级卡片 */
export interface TileItem {
  /** 卡片标识；展开、勾选、打开全部都按它回传 */
  id: number;
  /** 卡片标题，单行省略 */
  title: string;
  /** 卡片副标题，单行省略 */
  subtitle: string;
  /** 数量角标；为 null 时不显示 */
  count: number | null;
  /** 封面缩略图 Data URL；没有就显示占位图标 */
  cover: string | null;
}

/** 卡片复选框的选中状态；三态只用于图库页的角色卡 */
export type TileSelectState = 'none' | 'checked' | 'indeterminate';
