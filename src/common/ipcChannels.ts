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

  // 通用输入窗口
  PROMPT_OPEN: 'prompt:open',
  PROMPT_INIT: 'prompt:init',
  PROMPT_CONFIRM: 'prompt:confirm',
  BATCH_RENAME_CONFIRMED: 'character:rename-batch-confirmed',
  SINGLE_RENAME_CONFIRMED: 'character:rename-single-confirmed',
  SCRIPT_RENAME_CONFIRMED: 'script:rename-confirmed',

  // 文件查看窗口
  FILE_VIEWER_OPEN: 'file-viewer:open',
  FILE_VIEWER_INIT: 'file-viewer:init',
  FILE_VIEWER_SELECT: 'file-viewer:select',
  FILE_VIEWER_SELECTED: 'file-viewer:selected',

  // 脚本下拉浮窗
  DROPDOWN_OPEN: 'script-list:open',
  DROPDOWN_INIT: 'script-list:init',
  DROPDOWN_SELECT: 'script-list:select',
  DROPDOWN_SELECTED: 'script-list:selected',
} as const;
