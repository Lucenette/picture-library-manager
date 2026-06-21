import { initSystem } from "@/dialogs/system";
import { initImageViewer } from "@/dialogs/image-viewer";
import { initScanConfig } from "@/dialogs/scan-config";
import { initDropdown } from "@/dialogs/control/dropdown";

const initControls = () => {
    initDropdown(); // 初始化下拉列表控件
};

export const initDialogs = () => {
    initSystem(); // 初始化系统原生弹窗
    initImageViewer(); // 初始化图像查看器窗口
    initScanConfig(); // 初始化扫描配置窗口
    initControls(); // 初始化模拟系统控件
};
