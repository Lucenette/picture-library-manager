// ============================================================
// IPC 通道名 —— 全局统一引用，避免任何硬编码字符串
// ============================================================

export const IPC = {
  /** 数据库统一调度通道：调用方需携带方法名与参数 */
  DB: 'db',

  // 系统原生对话框
  DIALOG_OPEN_DIR: 'dialog:openDir',
  DIALOG_OPEN_SCRIPT: 'dialog:openScript',
  DIALOG_EXPORT_DIR: 'dialog:exportDir',

  // 图片查看器窗口
  VIEWER_OPEN: 'viewer:open',
  VIEWER_GET_DATA: 'viewer:getData',

  // 扫描配置窗口
  SCAN_CONFIG_OPEN: 'scan-config:open',
  SCAN_CONFIG_INIT: 'scan-config:init',
  SCAN_CONFIG_CONFIRM: 'scan-config:confirm',
  SCAN_CONFIG_CONFIRMED: 'scan-config:confirmed',

  // 批量处理窗口
  BATCH_PROCESS_OPEN: 'batch-process:open',
  BATCH_PROCESS_INIT: 'batch-process:init',
  BATCH_PROCESS_CONFIRM: 'batch-process:confirm',
  BATCH_PROCESS_CONFIRMED: 'batch-process:confirmed',

  // 原生确认 / 提示窗口
  CONFIRM_OPEN: 'confirm:open',
  CONFIRM_INIT: 'confirm:init',
  CONFIRM_SUBMIT: 'confirm:submit',
  /** 弹窗结果回发到主窗口的通道 */
  CONFIRM_RESULT: 'confirm:result',

  // 通用输入窗口
  PROMPT_OPEN: 'prompt:open',
  PROMPT_INIT: 'prompt:init',
  PROMPT_CONFIRM: 'prompt:confirm',
  BATCH_RENAME_CONFIRMED: 'character:rename-batch-confirmed',
  SINGLE_RENAME_CONFIRMED: 'character:rename-single-confirmed',

  // 文件查看窗口
  FILE_VIEWER_OPEN: 'file-viewer:open',
  FILE_VIEWER_INIT: 'file-viewer:init',
  FILE_VIEWER_SELECT: 'file-viewer:select',
  FILE_VIEWER_SELECTED: 'file-viewer:selected',

  // 处理脚本子系统：正文在用户目录的 scripts/ 下，操作不只是查库，所以不挂在 DB 通道上
  SCRIPT_LIST: 'script:list',
  SCRIPT_LIST_BY_TYPE: 'script:listByType',
  SCRIPT_READ: 'script:read',
  SCRIPT_CHECK: 'script:check',
  SCRIPT_IMPORT: 'script:import',
  SCRIPT_SAVE: 'script:save',
  SCRIPT_DELETE: 'script:delete',
  SCRIPT_USAGE: 'script:usage',
  SCRIPT_RESET_BUILTIN: 'script:resetBuiltin',
  /** 列表项的原生右键菜单：清单由渲染进程给，主进程弹完把点中的动作 id 回过来 */
  SCRIPT_MENU: 'script:menu',
  /** 重命名弹框确认后的回发通道（见 common/types.ts 的 PromptInitData） */
  SCRIPT_RENAME_CONFIRMED: 'script:rename-confirmed',
  SCRIPT_RENAME: 'script:rename',
  SCRIPT_DRAFT_LIST: 'script:draftList',
  SCRIPT_DRAFT_PUT: 'script:draftPut',
  SCRIPT_DRAFT_DELETE: 'script:draftDelete',

  // 脚本分组：真正落库的只有具名分组，「未分组」是 groupId 为 null 的默认落点
  SCRIPT_GROUP_LIST: 'script:groupList',
  SCRIPT_GROUP_CREATE: 'script:groupCreate',
  SCRIPT_GROUP_RENAME: 'script:groupRename',
  SCRIPT_GROUP_DELETE: 'script:groupDelete',
  SCRIPT_GROUP_COLLAPSE: 'script:groupCollapse',
  SCRIPT_GROUP_ASSIGN: 'script:groupAssign',
  /** 分组输入弹框确认后的回发通道：带 groupId 是改名，不带是新建 */
  SCRIPT_GROUP_CONFIRMED: 'script:groupConfirmed',

  // 后台任务
  TASK_SUBMIT: 'task:submit',
  TASK_CANCEL: 'task:cancel',
  TASK_PAUSE: 'task:pause',
  TASK_RESUME: 'task:resume',
  TASK_FORCE_STOP: 'task:forceStop',
  TASK_MOVE: 'task:move',
  TASK_RETRY: 'task:retry',
  TASK_LIST: 'task:list',
  TASK_CLEAR_FINISHED: 'task:clearFinished',
  TASK_CHANGED: 'task:changed',
  TASK_PROGRESS: 'task:progress',

  // 相似图片识别结果窗口
  SIMILAR_OPEN: 'similar:open',
  SIMILAR_DATA: 'similar:data',

  // 脚本下拉浮窗（内容由浮窗宿主渲染）
  DROPDOWN_OPEN: 'script-list:open',
  DROPDOWN_SELECT: 'script-list:select',
  DROPDOWN_SELECTED: 'script-list:selected',

  // 类型过滤浮窗：自己一组，不与脚本下拉共用——多选、勾完不关窗，行为本来就不同
  TYPE_FILTER_OPEN: 'type-filter:open',
  /** 每勾一次回发一次当前选择 */
  TYPE_FILTER_CHANGE: 'type-filter:change',
  TYPE_FILTER_CHANGED: 'type-filter:changed',

  // 仿原生浮窗宿主：一个窗口服务全部浮窗，内容与位置在每次展开时推给它
  POPUP_SHOW: 'popup:show',
  /** 浮窗是否可见：主窗口据此决定要不要跟着失焦压暗 */
  POPUP_VISIBLE: 'popup:visible',
  POPUP_STATE: 'popup:state',
  POPUP_HIDE: 'popup:hide',

  // 启动加载服务：加载页的状态、渲染进程任务的登记与下发
  LOAD_STATE: 'load:state',
  LOAD_PROGRESS: 'load:progress',
  LOAD_QUIT: 'load:quit',
  /** 主进程 → 渲染进程：下发一个渲染进程任务 */
  LOAD_TASK: 'load:task',
  /** 渲染进程 → 主进程：任务跑完的回执 */
  LOAD_TASK_DONE: 'load:taskDone',
} as const;

/** 渲染进程侧的加载任务 id：主进程按它下发，渲染进程按它认领实现 */
export const LOAD_TASK = {
  /** 预热脚本管理页（连带编辑器那一大坨依赖） */
  EDITOR: 'editor',
} as const;
