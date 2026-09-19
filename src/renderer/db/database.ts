import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type {
  Character, Gallery, ImageFile, ImageGroup, ImageGroupStatus, ImageGroupView,
  ProcessedImage, ProcessedImageView, ProcessScript, ScannedFile, ScriptType,
} from '@common/types';

/** 调用主进程的数据库方法 */
function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(IPC.DB, method, ...args) as Promise<T>;
}

// ------------------------------------------------------------
// 批量提交
// ------------------------------------------------------------

/** 开始批量写入，期间的改动只在主进程内存中累积 */
export function beginBatch(): Promise<void> {
  return call('beginBatch');
}

/** 结束批量写入并立即落盘 */
export function endBatch(): Promise<void> {
  return call('endBatch');
}

// ------------------------------------------------------------
// Gallery
// ------------------------------------------------------------

/** 新增图库 */
export function addGallery(name: string, rootPath: string): Promise<Gallery> {
  return call('addGallery', name, rootPath);
}

/** 查询全部图库 */
export function getAllGalleries(): Promise<Gallery[]> {
  return call('getAllGalleries');
}

/** 清空图库下的扫描数据 */
export function clearGalleryData(galleryId: number): Promise<void> {
  return call('clearGalleryData', galleryId);
}

/** 删除图库及其扫描数据 */
export function deleteGallery(galleryId: number): Promise<void> {
  return call('deleteGallery', galleryId);
}

/** 记录图库最近一次扫描完成时间 */
export function updateGalleryScannedAt(galleryId: number): Promise<void> {
  return call('updateGalleryScannedAt', galleryId);
}

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

/** 写入角色，同图库下同名时返回既有记录 */
export function insertCharacter(galleryId: number, name: string, sourcePath: string): Promise<Character> {
  return call('insertCharacter', galleryId, name, sourcePath);
}

/** 查询图库下的角色 */
export function getCharactersByGallery(galleryId: number): Promise<Character[]> {
  return call('getCharactersByGallery', galleryId);
}

/** 重命名角色 */
export function renameCharacter(id: number, name: string): Promise<void> {
  return call('renameCharacter', id, name);
}

// ------------------------------------------------------------
// ImageGroup
// ------------------------------------------------------------

/** 写入图片组，同路径时返回既有记录 */
export function insertImageGroup(
  characterId: number,
  dirName: string,
  dirPath: string,
  fileCount: number,
): Promise<ImageGroup> {
  return call('insertImageGroup', characterId, dirName, dirPath, fileCount);
}

/** 查询图片组列表 */
export function getImageGroupsView(status?: ImageGroupStatus, galleryId?: number): Promise<ImageGroupView[]> {
  return call('getImageGroupsView', status, galleryId);
}

/** 更新图片组状态 */
export function updateImageGroupStatus(id: number, status: ImageGroupStatus): Promise<void> {
  return call('updateImageGroupStatus', id, status);
}

/** 查询图片组内的图片文件 */
export function getImageFilesByGroup(groupId: number): Promise<ImageFile[]> {
  return call('getImageFilesByGroup', groupId);
}

/** 按文件路径反查所属图片组 */
export function getImageGroupIdByFilePath(filePath: string): Promise<number | null> {
  return call('getImageGroupIdByFilePath', filePath);
}

// ------------------------------------------------------------
// ImageFile
// ------------------------------------------------------------

/** 批量写入图片组内的图片文件 */
export function insertImageFiles(groupId: number, files: ScannedFile[]): Promise<void> {
  return call('insertImageFiles', groupId, files);
}

// ------------------------------------------------------------
// ProcessScript
// ------------------------------------------------------------

/** 新增或更新脚本 */
export function upsertScript(name: string, filePath: string, code: string): Promise<ProcessScript> {
  return call('upsertScript', name, filePath, code);
}

/** 用新源码覆盖已入库的脚本 */
export function reloadScript(filePath: string, code: string): Promise<ProcessScript> {
  return call('reloadScript', filePath, code);
}

/** 查询全部脚本 */
export function getAllScripts(): Promise<ProcessScript[]> {
  return call('getAllScripts');
}

/** 按 id 查询脚本 */
export function getScriptById(id: number): Promise<ProcessScript | undefined> {
  return call('getScriptById', id);
}

/** 查询能处理指定类型的脚本 */
export function getScriptsByType(type: ScriptType): Promise<ProcessScript[]> {
  return call('getScriptsByType', type);
}

/** 重命名脚本 */
export function renameScript(id: number, name: string): Promise<void> {
  return call('renameScript', id, name);
}

/** 删除脚本 */
export function deleteScript(id: number): Promise<void> {
  return call('deleteScript', id);
}

// ------------------------------------------------------------
// ProcessedImage
// ------------------------------------------------------------

/** 写入或更新图片组的选图结果 */
export function upsertProcessedImage(
  imageGroupId: number,
  characterId: number,
  galleryId: number,
  originalPath: string,
  selectedFile: string,
  scriptId: number | null,
): Promise<ProcessedImage> {
  return call('upsertProcessedImage', imageGroupId, characterId, galleryId, originalPath, selectedFile, scriptId);
}

/** 查询准图库列表 */
export function getAllProcessedImages(galleryId?: number, characterName?: string): Promise<ProcessedImageView[]> {
  return call('getAllProcessedImages', galleryId, characterName);
}

/** 删除准图库记录 */
export function deleteProcessedImage(id: number): Promise<void> {
  return call('deleteProcessedImage', id);
}
