// ============================================================
// 全局类型定义 —— 主进程与渲染进程共享的数据契约
// ============================================================

// ------------------------------------------------------------
// 实体
// ------------------------------------------------------------

/** 来源：一个受管理的图包根目录 */
export interface Source {
  id: number;
  name: string;
  rootPath: string;
  /** 最近一次扫描完成时间；从未扫描为 null */
  scannedAt: string | null;
  createdAt: string;
}

/** 角色：来源下按目录归并出的角色 */
export interface Character {
  id: number;
  sourceId: number;
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

/**
 * 处理脚本：正文存在用户目录的 `scripts/` 下，库里只留这一行索引。
 *
 * 运行时重新读文件并编译（见 `script/script-service.ts`），所以这里不带正文。
 */
export interface ProcessScript {
  id: number;
  name: string;
  /** 用户目录里那份脚本文件的绝对路径 */
  filePath: string;
  /** 脚本导出的方法类型：永远描述磁盘上的那一版 */
  types: ScriptType[];
  /** 内置脚本：源码随应用发布、不能删除，只能「恢复默认」 */
  builtin: boolean;
  /** 所属分组；`null` 就是「未分组」（默认分组不占 script_group 的行） */
  groupId: number | null;
  loadedAt: string;
  createdAt: string;
}

/**
 * 脚本分组。
 *
 * 「未分组」不是这里的一行：脚本的 `groupId` 为 `null` 就是它，位置固定在最后。
 * 名字允许重复，靠 `id` 区分。
 */
export interface ScriptGroup {
  id: number;
  name: string;
  /** 具名分组的折叠状态存库；「未分组」没地方存，只在本次停留期间有效 */
  collapsed: boolean;
}

/** 编译失败的位置；行或列取不到时为 null */
export interface ScriptCompileError {
  message: string;
  line: number | null;
  column: number | null;
}

/** 没保存的编辑草稿：一稿一文件存在 `temp/scripts/` 下 */
export interface ScriptDraft {
  /** `script-<id>`（已入库）或 `new-<uuid>`（新建未保存） */
  key: string;
  /** 名称也是可编辑可未保存的，所以跟着草稿走 */
  name: string;
  code: string;
  /**
   * 新建脚本预定的分组（`null` = 「未分组」）。
   *
   * 只有 `new-` 草稿带得动它：已入库脚本的分组在库里，草稿再存一份就是两份真相。
   */
  groupId?: number | null;
  updatedAt: string;
}

/** 打开一个脚本时读到的东西 */
export interface ScriptReadResult {
  /** 磁盘上的正文；文件缺失时为空串 */
  code: string;
  /** **将要显示的那一版**的编译结果：有草稿就是草稿，没有就是磁盘上的文件 */
  compileError: ScriptCompileError | null;
  /** 库里记着的类型关联：**永远描述磁盘上的那一版**，显示草稿时不要拿它当真 */
  types: ScriptType[];
  /** 这一个脚本的未保存草稿 */
  draft: ScriptDraft | null;
}

/** 保存一个脚本的结果 */
export interface ScriptSaveResult {
  script: ProcessScript;
  /** 刚写下去的那一版编译的结果；失败时类型关联为空 */
  compileError: ScriptCompileError | null;
}

/** 一次导入的结果：成功的逐条列出，失败的也要能看见 */
export interface ScriptImportResult {
  imported: ProcessScript[];
  failed: { path: string; message: string }[];
}

/** 图库记录：某个图片组最终确认下来的那张图 */
export interface ProcessedImage {
  id: number;
  imageGroupId: number;
  characterId: number;
  sourceId: number;
  originalPath: string;
  selectedFile: string;
  scriptId: number | null;
  confirmedAt: string;
  createdAt: string;
}

// ------------------------------------------------------------
// 视图 DTO（在实体基础上补齐关联字段，供列表直接渲染）
// ------------------------------------------------------------

/** 页面「图组管理」的图片组行 */
export interface ImageGroupView extends ImageGroup {
  characterName: string;
  sourceName: string;
  sourceId: number;
}

/** 「图库」页的行 */
export interface ProcessedImageView extends ProcessedImage {
  characterName: string;
  sourceName: string;
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
  /** 相对来源根的图片组路径 */
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
  sourceIds: number[];
  sourceName: string;
  sourceCount: number;
}

/** 扫描配置窗口的确认结果 */
export interface ScanConfigResult {
  sourceIds: number[];
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

/** 脚本列表的右键菜单项：有哪些项由渲染进程按当前状态决定，主进程只负责弹原生菜单 */
export interface ScriptMenuEntry {
  /** 动作 id，点中后原样回给渲染进程 */
  id: string;
  label: string;
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
  /** 脚本页重命名携带的草稿 key（`script-<id>` / `new-<uuid>`） */
  scriptKey?: string;
  /** 脚本页分组携带的分组 id：有它是改分组名，没有是新建分组 */
  groupId?: number;
  /** 进窗口后把预填的名字全选（新建分组用：回车用默认名，直接打字就把它覆盖掉） */
  selectAll?: boolean;
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

/** 类型过滤浮窗的一项 */
export interface TypeFilterOption {
  value: string;
  label: string;
}

/** 类型过滤浮窗的内容：候选与当前勾选 */
export interface TypeFilterInitData {
  options: TypeFilterOption[];
  selected: string[];
}

/** 浮窗的定位信息：触发控件在所在窗口里的位置，以及期望的高度 */
export interface DropdownPlacement {
  controlRect: { x: number; y: number; width: number; height: number };
  listHeight: number;
}

/** 脚本下拉浮窗的打开请求，除候选数据外还需定位信息 */
export interface ScriptListOpenData extends ScriptListInitData, DropdownPlacement {}

/** 类型过滤浮窗的打开请求，同样是内容 + 定位 */
export interface TypeFilterOpenData extends TypeFilterInitData, DropdownPlacement {}

// ------------------------------------------------------------
// 后台任务
// ------------------------------------------------------------

/** 任务类型 */
export type TaskType = 'scan' | 'process' | 'export' | 'similar';

/** 任务状态；paused 与 running 一样占用队列 */
export type TaskStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

/** 扫描任务入参：一次扫描一个来源，便于独立取消与原子提交 */
export interface ScanTaskPayload {
  sourceId: number;
  scriptId: number;
}

/** 批量选图任务入参：提交时固化的图片组快照 */
export interface ProcessTaskPayload {
  groupIds: number[];
  scriptId: number;
}

/** 导出任务入参：提交时固化的图库记录快照 */
export interface ExportTaskPayload {
  imageIds: number[];
  targetDir: string;
}

/** 识别相似图片：没有入参，比对的是「图库」页里的全部图片 */
export type SimilarTaskPayload = Record<string, never>;

/** 识别相似图片的结果统计 */
export interface SimilarTaskResult {
  /** 参与比对的张数 */
  compared: number;
  /** 因为没有感知哈希而跳过的张数（老数据要重扫一次才有） */
  skipped: number;
  sameGroups: number;
  similarGroups: number;
}

export type TaskPayload = ScanTaskPayload | ProcessTaskPayload | ExportTaskPayload | SimilarTaskPayload;

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

// ------------------------------------------------------------
// 相似图片识别
// ------------------------------------------------------------

/** 相似图片结果里的一张图 */
export interface SimilarMember {
  filePath: string;
  fileName: string;
  /** 缩略图 Data URL，供界面直接显示 */
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  /** 与同组锚点的汉明距离；锚点自己为 0 */
  distance: number;
}

/** 一组相同或相似的图片 */
export interface SimilarGroup {
  /** same：彼此"相同"的图；similar：彼此"相似"但不是同一张的证据不足 */
  kind: 'same' | 'similar';
  members: SimilarMember[];
}

/** 相似图片识别的完整结果 */
export interface SimilarData {
  same: SimilarGroup[];
  similar: SimilarGroup[];
  /** 参与比对的张数 */
  compared: number;
  /** 因为没有感知哈希而跳过的张数（老数据要重扫一次才有） */
  skipped: number;
}

export interface ProcessTaskResult {
  processed: number;
  failed: number;
}

export interface ExportTaskResult {
  copied: number;
  failed: number;
}

export type TaskResult = ScanTaskResult | ProcessTaskResult | ExportTaskResult | SimilarTaskResult;

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

/** 提交任务的返回：新任务的 id 与最新任务列表 */
export interface TaskSubmitResult {
  id: number;
  tasks: TaskView[];
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

/**
 * 仿原生浮窗的种类。
 *
 * 所有浮窗共用同一个窗口（同一时刻只可能有一个可见），靠 kind 切换渲染哪个组件；
 * 新增一种浮窗就在这里加一个字面量，并在渲染进程的 PopupHost 里登记对应组件。
 */
export type PopupKind = 'script-list' | 'type-filter';

/** 推给浮窗宿主的数据：kind 决定渲染哪个组件，payload 是那个组件自己的入参 */
export type PopupShowData =
  | { kind: 'script-list'; payload: ScriptListInitData }
  | { kind: 'type-filter'; payload: TypeFilterInitData };

/**
 * 加载服务的状态：由主进程公布，加载页只负责展示。
 *
 * 任务名与终态（succeeded / failed）由加载服务写，其余字段由任务通过 report() 增补。
 */
export interface LoadProgress {
  /** running = 还在加载，加载页挡着；succeeded = 可以进主界面；failed = 停下来等用户处理 */
  status: 'running' | 'succeeded' | 'failed';
  /** 当前「必须」任务的名称，加载页的标题 */
  title: string;
  /** 当前步骤的说明（如「1.0.1 添加 builtin 列」）；没有细分的任务为空串 */
  step: string;
  /** 已完成 / 总步数；没有细分的任务都是 0 */
  done: number;
  total: number;
  /** 整体百分比，0-100，由主进程算好 */
  percent: number;
  /** 失败原因；成功时为空串 */
  error: string;
  /** 附注：升级失败时是备份路径那句话 */
  note: string;
}

/** 主进程下发的渲染进程任务 */
export interface LoadTaskRequest {
  /** 回执里带回的序号，用来对上等待的一方 */
  requestId: number;
  /** 认领键，见 ipcChannels.ts 的 LOAD_TASK */
  id: string;
}

/** 渲染进程任务跑完的回执；error 为空串表示成功 */
export interface LoadTaskResult {
  requestId: number;
  error: string;
}
