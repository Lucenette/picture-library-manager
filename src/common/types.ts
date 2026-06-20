// ============================================================
// 全局类型定义
// ============================================================

/** 图库记录 */
export interface Gallery {
  id: number;
  name: string;
  rootPath: string;
  scannedAt: string | null;
  createdAt: string;
}

/** 角色记录 */
export interface Character {
  id: number;
  galleryId: number;
  name: string;
  sourcePath: string;
  createdAt: string;
}

/** 图片组状态 */
export type ImageGroupStatus = 'pending' | 'processed' | 'excluded';

/** 图片组记录 */
export interface ImageGroup {
  id: number;
  characterId: number;
  dirName: string;
  dirPath: string;
  fileCount: number;
  status: ImageGroupStatus;
  createdAt: string;
}

/** 图片文件记录 */
export interface ImageFile {
  id: number;
  imageGroupId: number;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  extension: string;
  thumbnail: string | null;
  createdAt: string;
}

/** 处理脚本记录 */
export interface ProcessScript {
  id: number;
  name: string;
  filePath: string;
  code: string;
  loadedAt: string;
  createdAt: string;
}

/** 已处理图片记录（准图库） */
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

// ============================================================
// 视图层 DTO（带关联字段）
// ============================================================

/** 页面二：图片组展示（带角色、图库信息） */
export interface ImageGroupView extends ImageGroup {
  characterName: string;
  galleryName: string;
  galleryId: number;
}

/** 页面三：准图库展示 */
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

// ============================================================
// 扫描相关类型
// ============================================================

/** 扫描时收集的单个文件信息 */
export interface ScannedFile {
  fileName: string;
  filePath: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  extension: string;
  thumbnail: string | null;
}

/** 扫描时收集的图片组信息 */
export interface ScannedGroup {
  dirName: string;
  dirPath: string;
  files: ScannedFile[];
}

/** 扫描时收集的角色信息 */
export interface ScannedCharacter {
  name: string;
  sourcePath: string;
  groups: ScannedGroup[];
}

/** 扫描进度回调参数 */
export interface ScanProgress {
  stage: 'scanning' | 'done';
  charactersFound: number;
  groupsFound: number;
  filesFound: number;
  currentCharacter: string | null;
}
