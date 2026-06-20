import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import * as S from '@/sql';
import type { Gallery, Character, ImageGroup, ImageGroupStatus, ImageFile, ProcessScript, ProcessedImage, ImageGroupView, ProcessedImageView } from '@common/types';

// ============================================================
// 常量
// ============================================================

export const IMAGE_EXTENSIONS = new Set(['png','jpg','jpeg','gif','webp','bmp','svg','avif','ico']);
export const VIRTUAL_GROUP_NAME = '(未分类)';

let db: SqlJsDatabase | null = null;
let dbPath: string;

// ============================================================
// 初始化
// ============================================================

export async function initDatabase(): Promise<void> {
  const dir = join(homedir(), '.picture-lib');
  mkdirSync(dir, { recursive: true });
  dbPath = join(dir, 'picture-lib.db');

  const SQL = await initSqlJs();
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  createTables();
  save();
}

function save(): void {
  if (!db) return;
  writeFileSync(dbPath, Buffer.from(db.export()));
}

// ============================================================
// 工具函数
// ============================================================

/** 将蛇形键名转为驼峰 */
function snakeToCamel(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result;
}

/** 执行 SELECT 返回多行 */
function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db!.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(snakeToCamel(stmt.getAsObject()) as unknown as T);
  stmt.free();
  return rows;
}

/** 执行 SELECT 返回单行 */
function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = db!.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? (snakeToCamel(stmt.getAsObject()) as unknown as T) : undefined;
  stmt.free();
  return row;
}

/** 执行 INSERT/UPDATE/DELETE，返回影响行数和 lastInsertRowid */
function run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number } {
  db!.run(sql, params);
  const lastId = (db!.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0) as number;
  save();
  return { changes: db!.getRowsModified(), lastInsertRowid: lastId };
}

function createTables(): void {
  for (const sql of S.DDL_ALL) db!.run(sql);
  save();
}

// ============================================================
// Gallery
// ============================================================

export function addGallery(name: string, rootPath: string): Gallery {
  const r = run(S.SQL_INSERT_GALLERY, [name, rootPath]);
  return queryOne<Gallery>(S.SQL_SELECT_GALLERY_BY_ID, [r.lastInsertRowid])!;
}

export function getAllGalleries(): Gallery[] {
  return queryAll<Gallery>(S.SQL_SELECT_GALLERY_ALL);
}

export function getGalleryById(id: number): Gallery | undefined {
  return queryOne<Gallery>(S.SQL_SELECT_GALLERY_BY_ID, [id]);
}

export function deleteGallery(id: number): void {
  run(S.SQL_DELETE_PROCESSED_BY_GALLERY, [id]);
  run(S.SQL_DELETE_IMAGE_FILES_BY_GALLERY, [id]);
  run(S.SQL_DELETE_IMAGE_GROUPS_BY_GALLERY, [id]);
  run(S.SQL_DELETE_CHARACTERS_BY_GALLERY, [id]);
  run(S.SQL_DELETE_GALLERY, [id]);
}

export function updateGalleryScannedAt(id: number): void {
  run(S.SQL_UPDATE_GALLERY_SCAN, [id]);
}

// ============================================================
// Character
// ============================================================

export function insertCharacter(galleryId: number, name: string, sourcePath: string): Character {
  run(S.SQL_INSERT_CHARACTER, [galleryId, name, sourcePath]);
  return queryOne<Character>(S.SQL_SELECT_CHARACTER_BY_GALLERY_NAME, [galleryId, name])!;
}

export function getCharactersByGallery(galleryId: number): Character[] {
  return queryAll<Character>(S.SQL_SELECT_CHARACTERS_BY_GALLERY, [galleryId]);
}

// ============================================================
// ImageGroup
// ============================================================

export function insertImageGroup(characterId: number, dirName: string, dirPath: string, fileCount: number): ImageGroup {
  run(S.SQL_INSERT_IMAGE_GROUP, [characterId, dirName, dirPath, fileCount]);
  return queryOne<ImageGroup>(S.SQL_SELECT_IMAGE_GROUP_BY_PATH, [dirPath])!;
}

export function updateImageGroupFileCount(id: number, count: number): void {
  run(S.SQL_UPDATE_IMAGE_GROUP_FILE_COUNT, [count, id]);
}

export function getImageGroupsView(status?: ImageGroupStatus, galleryId?: number): ImageGroupView[] {
  let sql = S.SQL_SELECT_IMAGE_GROUPS_VIEW_BASE;
  const params: any[] = [];
  if (status) { sql += ' AND ig.status = ?'; params.push(status); }
  if (galleryId) { sql += ' AND g.id = ?'; params.push(galleryId); }
  sql += ' ORDER BY g.name, c.name, ig.dir_name';
  return queryAll<ImageGroupView>(sql, params);
}

export function updateImageGroupStatus(id: number, status: ImageGroupStatus): void {
  run(S.SQL_UPDATE_IMAGE_GROUP_STATUS, [status, id]);
}

export function getImageFilesByGroup(groupId: number): ImageFile[] {
  return queryAll<ImageFile>(S.SQL_SELECT_IMAGE_FILES_BY_GROUP, [groupId]);
}

// ============================================================
// ImageFile
// ============================================================

export function insertImageFiles(
  groupId: number,
  files: Array<{ fileName: string; filePath: string; fileSize: number; width: number | null; height: number | null; extension: string }>,
): void {
  const stmt = db!.prepare(S.SQL_INSERT_IMAGE_FILE);
  for (const f of files) { stmt.run([groupId, f.fileName, f.filePath, f.fileSize, f.width, f.height, f.extension]); }
  stmt.free();
  save();
}

// ============================================================
// ProcessScript
// ============================================================

export function upsertScript(name: string, filePath: string, code: string): ProcessScript {
  const existing = queryOne<ProcessScript>(S.SQL_SELECT_SCRIPT_BY_PATH, [filePath]);
  if (existing) {
    run(S.SQL_UPDATE_SCRIPT, [name, code, filePath]);
  } else {
    run(S.SQL_INSERT_SCRIPT, [name, filePath, code]);
  }
  return queryOne<ProcessScript>(S.SQL_SELECT_SCRIPT_BY_PATH, [filePath])!;
}

export function reloadScript(filePath: string, code: string): ProcessScript {
  run(S.SQL_RELOAD_SCRIPT, [code, filePath]);
  return queryOne<ProcessScript>(S.SQL_SELECT_SCRIPT_BY_PATH, [filePath])!;
}

export function getAllScripts(): ProcessScript[] {
  return queryAll<ProcessScript>(S.SQL_SELECT_SCRIPTS_ALL);
}

export function getScriptById(id: number): ProcessScript | undefined {
  return queryOne<ProcessScript>(S.SQL_SELECT_SCRIPT_BY_ID, [id]);
}

export function deleteScript(id: number): void {
  run(S.SQL_DELETE_SCRIPT, [id]);
}

// ============================================================
// ProcessedImage
// ============================================================

export function upsertProcessedImage(
  imageGroupId: number, characterId: number, galleryId: number,
  originalPath: string, selectedFile: string, scriptId: number | null,
): ProcessedImage {
  const existing = queryOne<ProcessedImage>(S.SQL_SELECT_PROCESSED_BY_GROUP, [imageGroupId]);
  if (existing) {
    run(S.SQL_UPDATE_PROCESSED, [selectedFile, scriptId, imageGroupId]);
  } else {
    run(S.SQL_INSERT_PROCESSED, [imageGroupId, characterId, galleryId, originalPath, selectedFile, scriptId]);
  }
  run(S.SQL_UPDATE_IMAGE_GROUP_PROCESSED, [imageGroupId]);
  return queryOne<ProcessedImage>(S.SQL_SELECT_PROCESSED_BY_GROUP, [imageGroupId])!;
}

export function getAllProcessedImages(galleryId?: number, characterId?: number): ProcessedImageView[] {
  let sql = S.SQL_SELECT_PROCESSED_VIEW_BASE;
  const params: any[] = [];
  if (galleryId) { sql += ' AND pi.gallery_id = ?'; params.push(galleryId); }
  if (characterId) { sql += ' AND pi.character_id = ?'; params.push(characterId); }
  sql += ' ORDER BY c.name';
  return queryAll<ProcessedImageView>(sql, params);
}

export function deleteProcessedImage(id: number): void {
  const r = queryOne<{ image_group_id: number }>(S.SQL_SELECT_PROCESSED_BY_ID_GROUP, [id]);
  if (!r) return;
  run(S.SQL_DELETE_PROCESSED, [id]);
  run(S.SQL_UPDATE_GROUP_PENDING, [r.image_group_id]);
}

/** 关闭数据库并落盘 */
export function closeDatabase(): void {
  if (db) {
    save();
    db.close();
    db = null;
  }
}
