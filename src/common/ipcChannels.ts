// ============================================================
// IPC 通道名称常量 —— 全局统一引用，杜绝硬编码
// ============================================================

export const IPC = {
  DB: 'db',

  DIALOG_OPEN_DIR: 'dialog:openDir',
  DIALOG_OPEN_SCRIPT: 'dialog:openScript',
  DIALOG_EXPORT_DIR: 'dialog:exportDir',

  VIEWER_OPEN: 'viewer:open',
  VIEWER_GET_DATA: 'viewer:getData',

  SCAN_CONFIG_OPEN: 'scan-config:open',
  SCAN_CONFIG_INIT: 'scan-config:init',
  SCAN_CONFIG_CONFIRM: 'scan-config:confirm',
  SCAN_CONFIG_CONFIRMED: 'scan-config:confirmed',

  BATCH_PROCESS_OPEN: 'batch-process:open',
  BATCH_PROCESS_INIT: 'batch-process:init',
  BATCH_PROCESS_CONFIRM: 'batch-process:confirm',
  BATCH_PROCESS_CONFIRMED: 'batch-process:confirmed',

  PROMPT_OPEN: 'prompt:open',
  PROMPT_INIT: 'prompt:init',
  PROMPT_CONFIRM: 'prompt:confirm',
  BATCH_RENAME_CONFIRMED: 'character:rename-batch-confirmed',
  SINGLE_RENAME_CONFIRMED: 'character:rename-single-confirmed',
  SCRIPT_RENAME_CONFIRMED: 'script:rename-confirmed',

  FILE_VIEWER_OPEN: 'file-viewer:open',
  FILE_VIEWER_INIT: 'file-viewer:init',
  FILE_VIEWER_SELECT: 'file-viewer:select',
  FILE_VIEWER_SELECTED: 'file-viewer:selected',

  DROPDOWN_OPEN: 'script-list:open',
  DROPDOWN_INIT: 'script-list:init',
  DROPDOWN_SELECT: 'script-list:select',
  DROPDOWN_SELECTED: 'script-list:selected',
} as const;
