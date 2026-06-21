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

  DROPDOWN_OPEN: 'script-list:open',
  DROPDOWN_INIT: 'script-list:init',
  DROPDOWN_SELECT: 'script-list:select',
  DROPDOWN_SELECTED: 'script-list:selected',
} as const;
