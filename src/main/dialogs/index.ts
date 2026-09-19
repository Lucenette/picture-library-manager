import { initBatchProcess } from '@/dialogs/batch-process';
import { initDropdown } from '@/dialogs/control/dropdown';
import { initFileViewer } from '@/dialogs/file-viewer';
import { initImageViewer } from '@/dialogs/image-viewer';
import { initPrompt } from '@/dialogs/prompt';
import { initScanConfig } from '@/dialogs/scan-config';
import { initSystem } from '@/dialogs/system';

/** 注册全部原生窗口与系统对话框 */
export function initDialogs(): void {
  initSystem();
  initImageViewer();
  initScanConfig();
  initBatchProcess();
  initPrompt();
  initFileViewer();
  initDropdown();
}
