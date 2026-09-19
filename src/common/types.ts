// ============================================================
// 全局类型定义 —— 主进程与渲染进程共享的数据契约
// ============================================================

// ------------------------------------------------------------
// 实体
// ------------------------------------------------------------

/** 图库：一个受管理的图包根目录 */
export interface Gallery {
  id: number;
  name: string;
  rootPath: string;
  /** 最近一次扫描完成时间；从未扫描为 null */
  scannedAt: string | null;
  createdAt: string;
}

/** 角色：图库下按目录归并出的角色 */
export interface Character {
  id: number;
  galleryId: number;
  name: string;
  sourcePath: string;
  createdAt: string;
}

/** 图片组状态：未处理 / 已处理 / 已排除 */
export type ImageGroupStatus = 'pending' | 'processed' | 'excluded';

/** 图片组：一个角色下的图片集合 */
export interface ImageGroup {
  id: number;
  characterId: number;
  dirName: string;
  dirPath: string;
  fileCount: number;
  status: ImageGroupStatus;
  createdAt: string;
}

/** 图片文件：图片组内的一张图片及其元数据 */
export interface ImageFile {
  id: number;
  imageGroupId: number;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  extension: string;
  /** 100×100 中心裁剪缩略图的 base64 Data URL；生成失败为 null */
  thumbnail: string | null;
  createdAt: string;
}

/** 处理脚本类型 */
export type ScriptType = 'select-image' | 'identify-character' | 'identify-structure';

/** 处理脚本：存放在数据库中、由扫描与选图流程调用的 CommonJS 模块 */
export interface ProcessScript {
  id: number;
  name: string;
  filePath: string;
  code: string;
  /** 代码摘要，供列表展示 */
  brief: string;
  /** 脚本导出的方法类型 */
  types: ScriptType[];
  loadedAt: string;
  createdAt: string;
}

/** 准图库记录：某个图片组最终确认下来的那张图 */
export interface ProcessedImage {
  id: number;
  imageGroupId: number;
  characterId: number;
  galleryId: number;
  originalPath: string;
  selectedFile: string;
  scriptId: number | null;
  confirmedAt: string;
  createdAt: string;
}

// ------------------------------------------------------------
// 视图 DTO（在实体基础上补齐关联字段，供列表直接渲染）
// ------------------------------------------------------------

/** 页面「图组确认」的图片组行 */
export interface ImageGroupView extends ImageGroup {
  characterName: string;
  galleryName: string;
  galleryId: number;
}

/** 页面「图库导出」的准图库行 */
export interface ProcessedImageView extends ProcessedImage {
  characterName: string;
  galleryName: string;
  scriptName: string | null;
  selectedFileName: string;
  selectedFileThumbnail: string | null;
  selectedFileWidth: number | null;
  selectedFileHeight: number | null;
  selectedFileSize: number | null;
}

// ------------------------------------------------------------
// 扫描
// ------------------------------------------------------------

/** 目录树节点；children 为 null 表示文件，[] 表示空目录 */
export interface DirNode {
  name: string;
  path: string;
  children: DirNode[] | null;
}

/** identify-structure 脚本的入参 */
export interface StructureInput {
  rootPath: string;
  tree: DirNode[];
}

/** identify-structure 脚本的返回值 */
export interface StructureOutput {
  name: string;
  /** 相对图库根的图片组路径 */
  groups: string[];
}

/** 扫描阶段收集到、尚未入库的图片文件 */
export interface ScannedFile {
  fileName: string;
  filePath: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  extension: string;
  /** WebP 原始字节；生成失败为 null */
  thumbnail: Uint8Array | null;
  /** 64 位感知哈希；生成失败为 null */
  phash: Uint8Array | null;
}

/** 扫描阶段收集到的图片组 */
export interface ScannedGroup {
  dirName: string;
  dirPath: string;
  files: ScannedFile[];
}

/** 扫描阶段收集到的角色 */
export interface ScannedCharacter {
  name: string;
  sourcePath: string;
  groups: ScannedGroup[];
}

// ------------------------------------------------------------
// 原生窗口初始化数据
// ------------------------------------------------------------

/** 脚本候选项 */
export interface ScriptOption {
  id: number;
  name: string;
}

/** 图片查看器中的一张图片 */
export interface ViewerFile {
  filePath: string;
  fileName?: string;
  relativePath?: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null;
}

/** 打开图片查看器时下发的数据 */
export interface ViewerPayload {
  files: ViewerFile[];
  index: number;
}

/** 扫描配置窗口初始化数据 */
export interface ScanConfigInitData {
  scripts: ScriptOption[];
  galleryIds: number[];
  galleryName: string;
  galleryCount: number;
}

/** 扫描配置窗口的确认结果 */
export interface ScanConfigResult {
  galleryIds: number[];
  scriptId: number;
}

/** 批量处理窗口初始化数据 */
export interface BatchProcessInitData {
  scripts: ScriptOption[];
  count: number;
}

/**
 * 原生确认 / 提示窗口的初始化数据。
 *
 * `mode` 为 `confirm` 时显示两个按钮，为 `alert` 时只显示确认按钮。
 */
export interface ConfirmDialogData {
  title: string;
  /** 正文，可含换行 */
  message: string;
  /** 确认按钮文案，默认「确定」 */
  confirmText?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string;
  mode?: 'confirm' | 'alert';
  /** 危险操作，确认按钮标红 */
  danger?: boolean;
  /** 结果回发到主窗口的通道名 */
  channel: string;
  /** 原样带回调用方的上下文 */
  payload?: unknown;
}

/** 原生确认 / 提示窗口的结果 */
export interface ConfirmDialogResult {
  channel: string;
  confirmed: boolean;
  payload?: unknown;
}

/** 通用输入窗口初始化数据 */
export interface PromptInitData {
  title: string;
  placeholder?: string;
  value?: string;
  /** 确认结果要回发的通道名 */
  channel: string;
  /** 单条重命名等场景携带的行 id */
  rowId?: number;
}

/** 通用输入窗口的确认结果 */
export interface PromptResult extends PromptInitData {
  value: string;
}

/** 文件查看窗口初始化数据 */
export interface FileViewerInitData {
  files: ImageFile[];
  groupName: string;
  groupDirPath: string;
}

/** 脚本下拉浮窗的候选数据 */
export interface ScriptListInitData {
  scripts: ScriptOption[];
  selectedId: number | null;
}

/** 脚本下拉浮窗的打开请求，除候选数据外还需定位信息 */
export interface ScriptListOpenData extends ScriptListInitData {
  controlRect: { x: number; y: number; width: number; height: number };
  listHeight: number;
}

// ------------------------------------------------------------
// 后台任务
// ------------------------------------------------------------

/** 任务类型 */
export type TaskType = 'scan' | 'process' | 'export';

/** 任务状态；paused 与 running 一样占用队列 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

/** 扫描任务入参：一次扫描一个图库，便于独立取消与原子提交 */
export interface ScanTaskPayload {
  galleryId: number;
  scriptId: number;
}

/** 批量选图任务入参：提交时固化的图片组快照 */
export interface ProcessTaskPayload {
  groupIds: number[];
  scriptId: number;
}

/** 导出任务入参：提交时固化的准图库记录快照 */
export interface ExportTaskPayload {
  imageIds: number[];
  targetDir: string;
}

export type TaskPayload = ScanTaskPayload | ProcessTaskPayload | ExportTaskPayload;

/** 缩略图实际使用的解码引擎 */
export type ThumbnailEngineName = 'sharp' | 'builtin';

export interface ScanTaskResult {
  characters: number;
  groups: number;
  files: number;
  /** 成功生成缩略图的张数 */
  thumbnails: number;
  /** 生成失败（格式不支持、文件损坏或解码超时）的张数 */
  thumbnailFailures: number;
  /** 本次扫描实际使用的解码引擎；一张都没处理时为 none */
  thumbnailEngine: ThumbnailEngineName | 'none';
}

export interface ProcessTaskResult {
  processed: number;
  failed: number;
}

export interface ExportTaskResult {
  copied: number;
  failed: number;
}

export type TaskResult = ScanTaskResult | ProcessTaskResult | ExportTaskResult;

/** 任务在数据库中的存储形态 */
export interface TaskRow {
  id: number;
  type: TaskType;
  status: TaskStatus;
  /** 待执行任务之间的先后顺序 */
  queueOrder: number;
  /** 0 ~ 100 */
  progress: number;
  /** 当前阶段描述 */
  message: string;
  payload: string;
  result: string;
  error: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 推送给渲染进程的任务视图：payload/result 已解析，并附带可读标题 */
export interface TaskView extends Omit<TaskRow, 'payload' | 'result'> {
  title: string;
  payload: TaskPayload;
  result: TaskResult | null;
}

/** 高频进度事件，渲染进程只需原地打补丁 */
export interface TaskProgressEvent {
  id: number;
  progress: number;
  message: string;
}

/** 调整待执行任务顺序的方向 */
export type TaskMoveDirection = 'up' | 'down';
