import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type {
  Character, Gallery, ImageFile, ImageGroupStatus, ImageGroupView,
  ProcessedImage, ProcessedImageView, ProcessScript, ScriptType,
} from '@common/types';

/**
 * 渲染进程的数据库访问层。
 *
 * 只保留界面直接需要的读写；扫描、选图、导出这些批量写入都搬到了主进程的
 * 任务里，由它们直接调用数据库模块，不再经过 IPC。
 */
function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(IPC.DB, method, ...args) as Promise<T>;
}

// ------------------------------------------------------------
// Gallery
// ------------------------------------------------------------

/** 新增图库，名称由主进程取目录名 */
export function addGallery(rootPath: string): Promise<Gallery> {
  return call('addGallery', rootPath);
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

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

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
// ProcessScript
// ------------------------------------------------------------

/** 从磁盘导入脚本，源码由主进程读取 */
export function importScript(filePath: string): Promise<ProcessScript> {
  return call('importScript', filePath);
}

/** 用磁盘上的最新内容重新载入脚本 */
export function reloadScriptFromFile(filePath: string): Promise<ProcessScript> {
  return call('reloadScriptFromFile', filePath);
}

/** 查询全部脚本 */
export function getAllScripts(): Promise<ProcessScript[]> {
  return call('getAllScripts');
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

/** 写入或更新图片组的选图结果（手动确认走这里） */
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
