import { initBatchProcess } from '@/dialogs/batch-process';
import { initConfirm } from '@/dialogs/confirm';
import { initDropdown } from '@/dialogs/control/dropdown';
import { initPopup } from '@/dialogs/control/popup';
import { initFileViewer } from '@/dialogs/file-viewer';
import { initImageViewer } from '@/dialogs/image-viewer';
import { initPrompt } from '@/dialogs/prompt';
import { initScanConfig } from '@/dialogs/scan-config';
import { initSimilar } from '@/dialogs/similar';
import { initSystem } from '@/dialogs/system';

/** 注册系统原生对话框与全部辅助窗口 */
export function initDialogs(): void {
  initSystem();
  initConfirm();
  initImageViewer();
  initScanConfig();
  initBatchProcess();
  initPrompt();
  initFileViewer();
  initSimilar();
  initPopup();
  initDropdown();
}
