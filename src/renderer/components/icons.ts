import IconDownload from '~icons/lucide/download';
import IconFileCode from '~icons/lucide/file-code';
import IconFolder from '~icons/lucide/folder';
import IconFolderOpen from '~icons/lucide/folder-open';
import IconFolderPlus from '~icons/lucide/folder-plus';
import IconImage from '~icons/lucide/image';
import IconLayoutGrid from '~icons/lucide/layout-grid';
import IconList from '~icons/lucide/list';
import IconListChecks from '~icons/lucide/list-checks';
import IconPlus from '~icons/lucide/plus';
import IconSearch from '~icons/lucide/search';
import IconSettings from '~icons/lucide/settings';
import IconUser from '~icons/lucide/user';

/**
 * 语义名 → 图标组件：全仓唯一的图标来源。
 *
 * 组件只写语义名（`<AppIcon name="plus" />` 或 `:icon="ICONS.plus"`），不自己引图标集：
 * 换库、换某一处的图标、核对风格是否统一都只改这一张表。`~icons/*` 也只允许在本文件里引用，
 * 由 `eslint.config.mjs` 的 `no-restricted-imports` 守住。
 *
 * 图标是 `1em` 的 SVG、颜色走 `currentColor`，所以尺寸由所在位置的 `font-size` 决定
 * （外层是 `el-icon` 时就是它的 `size`），这里不写死尺寸与色值。
 */
export const ICONS = {
  /** 来源管理 */
  source: IconFolderOpen,
  /** 角色管理 */
  character: IconUser,
  /** 图组管理 */
  group: IconLayoutGrid,
  /** 图库 */
  library: IconImage,
  /** 脚本管理 */
  script: IconFileCode,
  /** 任务管理 */
  task: IconListChecks,
  /** 设置 */
  settings: IconSettings,
  /** 切到平铺视图 */
  tile: IconLayoutGrid,
  /** 切到列表视图 */
  list: IconList,
  /** 分组卡片没有封面时的占位 */
  emptyCover: IconImage,
  /** 搜索 */
  search: IconSearch,
  /** 新增 */
  plus: IconPlus,
  /** 导出 */
  download: IconDownload,
  /** 合着的分组（文件夹） */
  folder: IconFolder,
  /** 展开的分组 / 来源目录（打开的文件夹） */
  folderOpen: IconFolderOpen,
  /** 新建分组 */
  folderPlus: IconFolderPlus,
} as const;

/** 图标语义名；写成映射表里没有的名字在编译期就报 */
export type IconName = keyof typeof ICONS;
