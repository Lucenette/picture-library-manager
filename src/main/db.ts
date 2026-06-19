import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import type { Gallery, Character, ImageGroup, ImageGroupStatus, ImageFile, ProcessScript, ProcessedImage, ImageGroupView, ProcessedImageView } from '../renderer/types';

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

  db.run('PRAGMA foreign_keys = ON');
  createTables();
  save();
}

function save(): void {
  if (!db) return;
  writeFileSync(dbPath, Buffer.from(db.export()));
}

// ============================================================
// 工具函数（抹平 sql.js 与 better-sqlite3 的 API 差异）
// ============================================================

/** 执行 SELECT 返回多行 */
function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db!.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T);
  stmt.free();
  return rows;
}

/** 执行 SELECT 返回单行 */
function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = db!.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? (stmt.getAsObject() as unknown as T) : undefined;
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
  const d = db!;
  d.run(`CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, scanned_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  d.run(`CREATE TABLE IF NOT EXISTS character (id INTEGER PRIMARY KEY AUTOINCREMENT, gallery_id INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE, name TEXT NOT NULL, source_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), UNIQUE(gallery_id, name))`);
  d.run(`CREATE TABLE IF NOT EXISTS image_group (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE, dir_name TEXT NOT NULL, dir_path TEXT NOT NULL UNIQUE, file_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','excluded')), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  d.run(`CREATE TABLE IF NOT EXISTS image_file (id INTEGER PRIMARY KEY AUTOINCREMENT, image_group_id INTEGER NOT NULL REFERENCES image_group(id) ON DELETE CASCADE, file_name TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE, file_size INTEGER, width INTEGER, height INTEGER, extension TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  d.run('CREATE INDEX IF NOT EXISTS idx_image_file_group ON image_file(image_group_id)');
  d.run(`CREATE TABLE IF NOT EXISTS process_script (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, file_path TEXT NOT NULL UNIQUE, code TEXT NOT NULL, loaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  d.run(`CREATE TABLE IF NOT EXISTS processed_image (id INTEGER PRIMARY KEY AUTOINCREMENT, image_group_id INTEGER NOT NULL UNIQUE REFERENCES image_group(id) ON DELETE CASCADE, character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE, gallery_id INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE, original_path TEXT NOT NULL, selected_file TEXT NOT NULL, script_id INTEGER REFERENCES process_script(id) ON DELETE SET NULL, confirmed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  d.run('CREATE INDEX IF NOT EXISTS idx_processed_character ON processed_image(character_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_processed_gallery ON processed_image(gallery_id)');
  save();
}

// ============================================================
// Gallery
// ============================================================

export function addGallery(name: string, rootPath: string): Gallery {
  const r = run('INSERT INTO gallery (name, root_path) VALUES (?, ?)', [name, rootPath]);
  return queryOne<Gallery>('SELECT * FROM gallery WHERE id = ?', [r.lastInsertRowid])!;
}

export function getAllGalleries(): Gallery[] {
  return queryAll<Gallery>('SELECT * FROM gallery ORDER BY created_at DESC');
}

export function getGalleryById(id: number): Gallery | undefined {
  return queryOne<Gallery>('SELECT * FROM gallery WHERE id = ?', [id]);
}

export function deleteGallery(id: number): void {
  run('DELETE FROM gallery WHERE id = ?', [id]);
}

export function updateGalleryScannedAt(id: number): void {
  run("UPDATE gallery SET scanned_at = datetime('now','localtime') WHERE id = ?", [id]);
}

// ============================================================
// Character
// ============================================================

export function insertCharacter(galleryId: number, name: string, sourcePath: string): Character {
  run('INSERT OR IGNORE INTO character (gallery_id, name, source_path) VALUES (?, ?, ?)', [galleryId, name, sourcePath]);
  return queryOne<Character>('SELECT * FROM character WHERE gallery_id = ? AND name = ?', [galleryId, name])!;
}

export function getCharactersByGallery(galleryId: number): Character[] {
  return queryAll<Character>('SELECT * FROM character WHERE gallery_id = ? ORDER BY name', [galleryId]);
}

// ============================================================
// ImageGroup
// ============================================================

export function insertImageGroup(characterId: number, dirName: string, dirPath: string, fileCount: number): ImageGroup {
  run('INSERT OR IGNORE INTO image_group (character_id, dir_name, dir_path, file_count) VALUES (?, ?, ?, ?)', [characterId, dirName, dirPath, fileCount]);
  return queryOne<ImageGroup>('SELECT * FROM image_group WHERE dir_path = ?', [dirPath])!;
}

export function updateImageGroupFileCount(id: number, count: number): void {
  run('UPDATE image_group SET file_count = ? WHERE id = ?', [count, id]);
}

export function getImageGroupsView(status?: ImageGroupStatus, galleryId?: number): ImageGroupView[] {
  let sql = `SELECT ig.*, c.name AS characterName, g.name AS galleryName, g.id AS galleryId FROM image_group ig JOIN character c ON ig.character_id=c.id JOIN gallery g ON c.gallery_id=g.id WHERE 1=1`;
  const params: any[] = [];
  if (status) { sql += ' AND ig.status = ?'; params.push(status); }
  if (galleryId) { sql += ' AND g.id = ?'; params.push(galleryId); }
  sql += ' ORDER BY g.name, c.name, ig.dir_name';
  return queryAll<ImageGroupView>(sql, params);
}

export function updateImageGroupStatus(id: number, status: ImageGroupStatus): void {
  run('UPDATE image_group SET status = ? WHERE id = ?', [status, id]);
}

export function getImageFilesByGroup(groupId: number): ImageFile[] {
  return queryAll<ImageFile>('SELECT * FROM image_file WHERE image_group_id = ? ORDER BY file_name', [groupId]);
}

// ============================================================
// ImageFile
// ============================================================

export function insertImageFiles(
  groupId: number,
  files: Array<{ fileName: string; filePath: string; fileSize: number; width: number | null; height: number | null; extension: string }>,
): void {
  const stmt = db!.prepare('INSERT OR IGNORE INTO image_file (image_group_id, file_name, file_path, file_size, width, height, extension) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const f of files) { stmt.run([groupId, f.fileName, f.filePath, f.fileSize, f.width, f.height, f.extension]); }
  stmt.free();
  save();
}

// ============================================================
// ProcessScript
// ============================================================

export function upsertScript(name: string, filePath: string, code: string): ProcessScript {
  const existing = queryOne<ProcessScript>('SELECT * FROM process_script WHERE file_path = ?', [filePath]);
  if (existing) {
    run("UPDATE process_script SET name=?, code=?, loaded_at=datetime('now','localtime') WHERE file_path=?", [name, code, filePath]);
  } else {
    run("INSERT INTO process_script (name, file_path, code, loaded_at) VALUES (?, ?, ?, datetime('now','localtime'))", [name, filePath, code]);
  }
  return queryOne<ProcessScript>('SELECT * FROM process_script WHERE file_path = ?', [filePath])!;
}

export function reloadScript(filePath: string, code: string): ProcessScript {
  run("UPDATE process_script SET code=?, loaded_at=datetime('now','localtime') WHERE file_path=?", [code, filePath]);
  return queryOne<ProcessScript>('SELECT * FROM process_script WHERE file_path = ?', [filePath])!;
}

export function getAllScripts(): ProcessScript[] {
  return queryAll<ProcessScript>('SELECT * FROM process_script ORDER BY name');
}

export function getScriptById(id: number): ProcessScript | undefined {
  return queryOne<ProcessScript>('SELECT * FROM process_script WHERE id = ?', [id]);
}

export function deleteScript(id: number): void {
  run('DELETE FROM process_script WHERE id = ?', [id]);
}

// ============================================================
// ProcessedImage
// ============================================================

export function upsertProcessedImage(
  imageGroupId: number, characterId: number, galleryId: number,
  originalPath: string, selectedFile: string, scriptId: number | null,
): ProcessedImage {
  const existing = queryOne<ProcessedImage>('SELECT * FROM processed_image WHERE image_group_id = ?', [imageGroupId]);
  if (existing) {
    run("UPDATE processed_image SET selected_file=?, script_id=?, confirmed_at=datetime('now','localtime') WHERE image_group_id=?", [selectedFile, scriptId, imageGroupId]);
  } else {
    run("INSERT INTO processed_image (image_group_id, character_id, gallery_id, original_path, selected_file, script_id, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))", [imageGroupId, characterId, galleryId, originalPath, selectedFile, scriptId]);
  }
  run("UPDATE image_group SET status='processed' WHERE id=?", [imageGroupId]);
  return queryOne<ProcessedImage>('SELECT * FROM processed_image WHERE image_group_id = ?', [imageGroupId])!;
}

export function getAllProcessedImages(galleryId?: number, characterId?: number): ProcessedImageView[] {
  let sql = `SELECT pi.*, c.name AS characterName, g.name AS galleryName, ps.name AS scriptName FROM processed_image pi JOIN character c ON pi.character_id=c.id JOIN gallery g ON pi.gallery_id=g.id LEFT JOIN process_script ps ON pi.script_id=ps.id WHERE 1=1`;
  const params: any[] = [];
  if (galleryId) { sql += ' AND pi.gallery_id = ?'; params.push(galleryId); }
  if (characterId) { sql += ' AND pi.character_id = ?'; params.push(characterId); }
  sql += ' ORDER BY c.name';
  return queryAll<ProcessedImageView>(sql, params);
}

export function deleteProcessedImage(id: number): void {
  const r = queryOne<{ image_group_id: number }>('SELECT image_group_id FROM processed_image WHERE id = ?', [id]);
  if (!r) return;
  run('DELETE FROM processed_image WHERE id = ?', [id]);
  run("UPDATE image_group SET status='pending' WHERE id = ?", [r.image_group_id]);
}

/** 关闭数据库并落盘 */
export function closeDatabase(): void {
  if (db) {
    save();
    db.close();
    db = null;
  }
}
