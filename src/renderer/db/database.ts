import { ipcRenderer } from 'electron';
import type {
  Gallery,
  Character,
  ImageGroup,
  ImageGroupStatus,
  ImageFile,
  ProcessScript,
  ProcessedImage,
  ImageGroupView,
  ProcessedImageView,
} from '@common/types';

/** 调用主进程数据库方法 */
async function call<T>(method: string, ...args: any[]): Promise<T> {
  return ipcRenderer.invoke('db', method, ...args);
}

/** 图片扩展名白名单 */
export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico',
]);

/** 虚拟组名称 */
export const VIRTUAL_GROUP_NAME = '(未分类)';

// Gallery
export async function addGallery(name: string, rootPath: string): Promise<Gallery> { return call('addGallery', name, rootPath); }
export async function getAllGalleries(): Promise<Gallery[]> { return call('getAllGalleries'); }
export async function getGalleryById(id: number): Promise<Gallery | undefined> { return call('getGalleryById', id); }
export async function deleteGallery(id: number): Promise<void> { await call('deleteGallery', id); }
export async function clearGalleryData(id: number): Promise<void> { await call('clearGalleryData', id); }
export async function updateGalleryScannedAt(id: number): Promise<void> { await call('updateGalleryScannedAt', id); }

// Character
export async function insertCharacter(galleryId: number, name: string, sourcePath: string): Promise<Character> { return call('insertCharacter', galleryId, name, sourcePath); }
export async function getCharactersByGallery(galleryId: number): Promise<Character[]> { return call('getCharactersByGallery', galleryId); }

// ImageGroup
export async function insertImageGroup(characterId: number, dirName: string, dirPath: string, fileCount: number): Promise<ImageGroup> { return call('insertImageGroup', characterId, dirName, dirPath, fileCount); }
export async function updateImageGroupFileCount(id: number, count: number): Promise<void> { await call('updateImageGroupFileCount', id, count); }
export async function getImageGroupsView(status?: ImageGroupStatus, galleryId?: number): Promise<ImageGroupView[]> { return call('getImageGroupsView', status, galleryId); }
export async function updateImageGroupStatus(id: number, status: ImageGroupStatus): Promise<void> { await call('updateImageGroupStatus', id, status); }
export async function getImageFilesByGroup(groupId: number): Promise<ImageFile[]> { return call('getImageFilesByGroup', groupId); }

// ImageFile
export async function insertImageFiles(groupId: number, files: Array<{ fileName: string; filePath: string; fileSize: number; width: number | null; height: number | null; extension: string; thumbnail: string | null }>): Promise<void> { await call('insertImageFiles', groupId, files); }

// ProcessScript
export async function upsertScript(name: string, filePath: string, code: string): Promise<ProcessScript> { return call('upsertScript', name, filePath, code); }
export async function reloadScript(filePath: string, code: string): Promise<ProcessScript> { return call('reloadScript', filePath, code); }
export async function getAllScripts(): Promise<ProcessScript[]> { return call('getAllScripts'); }
export async function getScriptById(id: number): Promise<ProcessScript | undefined> { return call('getScriptById', id); }
export async function deleteScript(id: number): Promise<void> { await call('deleteScript', id); }

// ProcessedImage
export async function upsertProcessedImage(imageGroupId: number, characterId: number, galleryId: number, originalPath: string, selectedFile: string, scriptId: number | null): Promise<ProcessedImage> { return call('upsertProcessedImage', imageGroupId, characterId, galleryId, originalPath, selectedFile, scriptId); }
export async function getAllProcessedImages(galleryId?: number, characterName?: string): Promise<ProcessedImageView[]> { return call('getAllProcessedImages', galleryId, characterName); }
export async function deleteProcessedImage(id: number): Promise<void> { await call('deleteProcessedImage', id); }
