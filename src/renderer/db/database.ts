import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type {
  Character, Source, ImageFile, ImageGroupStatus, ImageGroupView,
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
// Source
// ------------------------------------------------------------

/** 新增来源，名称由主进程取目录名 */
export function addSource(rootPath: string): Promise<Source> {
  return call('addSource', rootPath);
}

/** 查询全部来源 */
export function getAllSources(): Promise<Source[]> {
  return call('getAllSources');
}

/** 清空来源下的扫描数据 */
export function clearSourceData(sourceId: number): Promise<void> {
  return call('clearSourceData', sourceId);
}

/** 删除来源及其扫描数据 */
export function deleteSource(sourceId: number): Promise<void> {
  return call('deleteSource', sourceId);
}

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

/** 查询来源下的角色 */
export function getCharactersBySource(sourceId: number): Promise<Character[]> {
  return call('getCharactersBySource', sourceId);
}

/** 重命名角色 */
export function renameCharacter(id: number, name: string): Promise<void> {
  return call('renameCharacter', id, name);
}

// ------------------------------------------------------------
// ImageGroup
// ------------------------------------------------------------

/** 查询图片组列表 */
export function getImageGroupsView(status?: ImageGroupStatus, sourceId?: number): Promise<ImageGroupView[]> {
  return call('getImageGroupsView', status, sourceId);
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

/**
 * 查询能处理指定类型的脚本。
 *
 * 其余的脚本操作（导入、保存、删除、草稿）要读写用户目录里的文件，走
 * `@/services/script-service` 的那一组 SCRIPT_* 通道；这里只留这一条列表查询，
 * 因为来源页与图组页只要「按类型挑脚本」。
 */
export function getScriptsByType(type: ScriptType): Promise<ProcessScript[]> {
  return call('getScriptsByType', type);
}

// ------------------------------------------------------------
// ProcessedImage
// ------------------------------------------------------------

/** 写入或更新图片组的选图结果（手动确认走这里） */
export function upsertProcessedImage(
  imageGroupId: number,
  characterId: number,
  sourceId: number,
  originalPath: string,
  selectedFile: string,
  scriptId: number | null,
): Promise<ProcessedImage> {
  return call('upsertProcessedImage', imageGroupId, characterId, sourceId, originalPath, selectedFile, scriptId);
}

/** 查询图库列表 */
export function getAllProcessedImages(sourceId?: number, characterName?: string): Promise<ProcessedImageView[]> {
  return call('getAllProcessedImages', sourceId, characterName);
}

/** 删除图库记录 */
export function deleteProcessedImage(id: number): Promise<void> {
  return call('deleteProcessedImage', id);
}
