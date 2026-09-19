import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync,
} from 'fs';
import { dirname, join } from 'path';
import { app, ipcMain } from 'electron';
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js';
import { IPC } from '@common/ipcChannels';
import { compileScriptModule } from '@common/script';
import type {
  Character, Gallery, ImageFile, ImageGroup, ImageGroupStatus, ImageGroupView,
  ProcessedImage, ProcessedImageView, ProcessScript, ScannedFile, ScriptType,
} from '@common/types';
import { DDL_ALL, SQL } from '@/sql';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/** 数据库文件名 */
const DB_FILE_NAME = 'picture-lib.db';

/** 脚本类型全集，用于检测脚本导出了哪些方法 */
const ALL_SCRIPT_TYPES: ScriptType[] = ['select-image', 'identify-character', 'identify-structure'];

/** 落盘防抖窗口：窗口内的连续写入合并为一次落盘 */
const SAVE_DEBOUNCE_MS = 300;

/** 落盘最大延迟：写入再密集也不会超过该间隔不落盘 */
const SAVE_MAX_DELAY_MS = 3000;

/** 备份最小间隔：避免每次落盘都复制整个数据库 */
const BACKUP_INTERVAL_MS = 30_000;

/** 脚本摘要长度 */
const BRIEF_MAX_LENGTH = 120;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

let db: SqlJsDatabase | null = null;
let dbPath = '';

/** 内存中是否有尚未落盘的改动 */
let dirty = false;

/** 批量提交的嵌套深度，大于 0 时改动只累积、不落盘 */
let batchDepth = 0;

let debounceTimer: NodeJS.Timeout | null = null;
let maxDelayTimer: NodeJS.Timeout | null = null;

/** 上次写入备份的时间戳 */
let lastBackupAt = 0;

// ------------------------------------------------------------
// 底层：查询
// ------------------------------------------------------------

/** 把 SQLite 的蛇形列名转换成前端的驼峰字段名 */
function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return result;
}

/** 执行 SELECT 并返回全部行 */
function queryAll<T>(sql: string, params: SqlValue[] = []): T[] {
  const statement = db!.prepare(sql);
  if (params.length) {
    statement.bind(params);
  }
  const rows: T[] = [];
  while (statement.step()) {
    rows.push(snakeToCamel(statement.getAsObject()) as unknown as T);
  }
  statement.free();
  return rows;
}

/** 执行 SELECT 并返回首行，无结果时返回 undefined */
function queryOne<T>(sql: string, params: SqlValue[] = []): T | undefined {
  const statement = db!.prepare(sql);
  if (params.length) {
    statement.bind(params);
  }
  const row = statement.step() ? (snakeToCamel(statement.getAsObject()) as unknown as T) : undefined;
  statement.free();
  return row;
}

/** 执行一条写语句（INSERT / UPDATE / DELETE）并标记改动 */
function run(sql: string, params: SqlValue[] = []): void {
  db!.run(sql, params);
  markDirty();
}

/** 执行一条 INSERT 并返回新行的 rowid */
function insert(sql: string, params: SqlValue[] = []): number {
  run(sql, params);
  return Number(db!.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0);
}

// ------------------------------------------------------------
// 底层：持久化
// ------------------------------------------------------------

/**
 * 标记存在未落盘的改动。
 *
 * 防抖窗口内的多次写入会合并为一次落盘，同时用最大延迟兜底，
 * 保证持续写入时也不会长时间不落盘；批量提交期间全部挂起，
 * 由 {@link endBatch} 一次性写入。
 */
function markDirty(): void {
  dirty = true;
  if (batchDepth > 0) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  maxDelayTimer ??= setTimeout(flushSave, SAVE_MAX_DELAY_MS);
}

/** 取消尚未触发的落盘定时器 */
function clearSaveTimers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxDelayTimer) {
    clearTimeout(maxDelayTimer);
    maxDelayTimer = null;
  }
}

/** 定时器回调：把累积的改动落盘，失败只记录日志（此时已无调用方可通知） */
function flushSave(): void {
  clearSaveTimers();
  try {
    persist();
  } catch (error) {
    console.error('[db] 数据库落盘失败：', error);
  }
}

/** 把内存数据库整体写回磁盘 */
function persist(): void {
  if (!db || !dirty) {
    return;
  }
  const snapshot = Buffer.from(db.export());
  backupDatabase();
  writeFileAtomic(dbPath, snapshot);
  dirty = false;
}

/** 按 {@link BACKUP_INTERVAL_MS} 保留一份上一版数据库，供误操作兜底 */
function backupDatabase(): void {
  if (!existsSync(dbPath)) {
    return;
  }
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_INTERVAL_MS) {
    return;
  }
  copyFileSync(dbPath, `${dbPath}.bak`);
  lastBackupAt = now;
}

/**
 * 先写临时文件并 fsync，再原子替换目标文件。
 *
 * 直接覆盖写一旦中途失败会留下半截数据库，先落地临时文件再替换
 * 可以保证目标文件要么是旧版本、要么是新版本。
 */
function writeFileAtomic(targetPath: string, data: Buffer): void {
  const tempPath = `${targetPath}.tmp`;
  const handle = openSync(tempPath, 'w');
  try {
    writeSync(handle, data);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(tempPath, targetPath);
}

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

/** 数据库目录：打包后位于 exe 同级的 data/，开发时位于项目 dist/data/ */
function getDataDir(): string {
  return app.isPackaged
    ? join(dirname(app.getPath('exe')), 'data')
    : join(process.cwd(), 'dist', 'data');
}

/** 打开（必要时创建）数据库并确保表结构就绪 */
export async function initDatabase(): Promise<void> {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  dbPath = join(dataDir, DB_FILE_NAME);

  const sqlJs = await initSqlJs();
  db = existsSync(dbPath) ? new sqlJs.Database(readFileSync(dbPath)) : new sqlJs.Database();

  for (const ddl of DDL_ALL) {
    db.run(ddl);
  }
  dirty = true;
  persist();
}

/** 落盘并关闭数据库，供退出前调用 */
export function closeDatabase(): void {
  if (!db) {
    return;
  }
  clearSaveTimers();
  try {
    persist();
  } catch (error) {
    console.error('[db] 退出前落盘失败：', error);
  }
  db.close();
  db = null;
}

// ------------------------------------------------------------
// 批量提交
// ------------------------------------------------------------

/** 开始一次批量写入：期间的改动只留在内存 */
export function beginBatch(): void {
  batchDepth += 1;
}

/** 结束一次批量写入：嵌套归零时立即落盘 */
export function endBatch(): void {
  if (batchDepth === 0) {
    return;
  }
  batchDepth -= 1;
  if (batchDepth > 0) {
    return;
  }
  clearSaveTimers();
  persist();
}

// ------------------------------------------------------------
// Gallery
// ------------------------------------------------------------

/** 新增图库；root_path 重复时由 SQLite 抛出唯一约束错误 */
export function addGallery(name: string, rootPath: string): Gallery {
  const id = insert(SQL.INSERT_GALLERY, [name, rootPath]);
  return queryOne<Gallery>(SQL.SELECT_GALLERY_BY_ID, [id])!;
}

/** 查询全部图库，按创建时间倒序 */
export function getAllGalleries(): Gallery[] {
  return queryAll<Gallery>(SQL.SELECT_GALLERY_ALL);
}

/** 清空图库下的全部扫描数据，保留图库本身，用于重新扫描 */
export function clearGalleryData(galleryId: number): void {
  run(SQL.DELETE_PROCESSED_BY_GALLERY, [galleryId]);
  run(SQL.DELETE_IMAGE_FILES_BY_GALLERY, [galleryId]);
  run(SQL.DELETE_IMAGE_GROUPS_BY_GALLERY, [galleryId]);
  run(SQL.DELETE_CHARACTERS_BY_GALLERY, [galleryId]);
}

/** 删除图库及其全部扫描数据 */
export function deleteGallery(galleryId: number): void {
  clearGalleryData(galleryId);
  run(SQL.DELETE_GALLERY, [galleryId]);
}

/** 记录图库最近一次扫描完成时间 */
export function updateGalleryScannedAt(galleryId: number): void {
  run(SQL.UPDATE_GALLERY_SCAN, [galleryId]);
}

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

/** 写入角色；同图库下同名已存在时忽略并返回既有记录 */
export function insertCharacter(galleryId: number, name: string, sourcePath: string): Character {
  run(SQL.INSERT_CHARACTER, [galleryId, name, sourcePath]);
  return queryOne<Character>(SQL.SELECT_CHARACTER_BY_GALLERY_NAME, [galleryId, name])!;
}

/** 查询图库下的角色，按名称升序 */
export function getCharactersByGallery(galleryId: number): Character[] {
  return queryAll<Character>(SQL.SELECT_CHARACTERS_BY_GALLERY, [galleryId]);
}

/** 重命名角色；与同图库内的角色重名时抛出可读错误 */
export function renameCharacter(id: number, name: string): void {
  try {
    run(SQL.RENAME_CHARACTER, [name, id]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`角色「${name}」已存在于当前图库`);
    }
    throw error;
  }
}

/** 判断是否为 SQLite 唯一约束冲突 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

// ------------------------------------------------------------
// ImageGroup
// ------------------------------------------------------------

/** 写入图片组；同路径已存在时忽略并返回既有记录 */
export function insertImageGroup(
  characterId: number,
  dirName: string,
  dirPath: string,
  fileCount: number,
): ImageGroup {
  run(SQL.INSERT_IMAGE_GROUP, [characterId, dirName, dirPath, fileCount]);
  return queryOne<ImageGroup>(SQL.SELECT_IMAGE_GROUP_BY_PATH, [dirPath])!;
}

/** 查询图片组列表，可按状态与图库过滤 */
export function getImageGroupsView(status?: ImageGroupStatus, galleryId?: number): ImageGroupView[] {
  let sql = SQL.SELECT_IMAGE_GROUPS_VIEW_BASE;
  const params: SqlValue[] = [];
  if (status) {
    sql += ' AND ig.status = ?';
    params.push(status);
  }
  if (galleryId) {
    sql += ' AND g.id = ?';
    params.push(galleryId);
  }
  return queryAll<ImageGroupView>(`${sql} ORDER BY g.name, c.name, ig.dir_name`, params);
}

/** 更新图片组状态；标记为已排除时同步清除其已处理记录 */
export function updateImageGroupStatus(id: number, status: ImageGroupStatus): void {
  run(SQL.UPDATE_IMAGE_GROUP_STATUS, [status, id]);
  if (status === 'excluded') {
    run(SQL.DELETE_PROCESSED_BY_GROUP, [id]);
  }
}

/** 查询图片组内的全部图片文件，按文件名升序 */
export function getImageFilesByGroup(groupId: number): ImageFile[] {
  return queryAll<ImageFile>(SQL.SELECT_IMAGE_FILES_BY_GROUP, [groupId]);
}

/** 按文件路径反查所属图片组；文件不在图库中时返回 null */
export function getImageGroupIdByFilePath(filePath: string): number | null {
  const row = queryOne<{ imageGroupId: number }>(SQL.SELECT_GROUP_ID_BY_FILE_PATH, [filePath]);
  return row?.imageGroupId ?? null;
}

// ------------------------------------------------------------
// ImageFile
// ------------------------------------------------------------

/** 批量写入图片组内的图片文件 */
export function insertImageFiles(groupId: number, files: ScannedFile[]): void {
  const statement = db!.prepare(SQL.INSERT_IMAGE_FILE);
  for (const file of files) {
    statement.run([
      groupId, file.fileName, file.filePath, file.fileSize,
      file.width, file.height, file.extension, file.thumbnail,
    ]);
  }
  statement.free();
  markDirty();
}

// ------------------------------------------------------------
// ProcessScript
// ------------------------------------------------------------

/** 生成脚本列表展示用的代码摘要 */
function makeBrief(code: string): string {
  const brief = code.replace(/\n/g, '\\n').slice(0, BRIEF_MAX_LENGTH);
  return brief.length >= BRIEF_MAX_LENGTH ? `${brief}…` : brief;
}

/** 检测脚本导出了哪些可识别的方法 */
export function detectScriptTypes(code: string): ScriptType[] {
  try {
    const scriptExports = compileScriptModule(code);
    return ALL_SCRIPT_TYPES.filter((type) => typeof scriptExports[type] === 'function');
  } catch {
    return [];
  }
}

/** 覆盖脚本的类型关联 */
function replaceScriptTypes(scriptId: number, types: ScriptType[]): void {
  run(SQL.DELETE_SCRIPT_TYPES, [scriptId]);
  for (const type of types) {
    run(SQL.INSERT_SCRIPT_TYPE, [scriptId, type]);
  }
}

/** 读取脚本的类型关联 */
function getScriptTypes(scriptId: number): ScriptType[] {
  return queryAll<{ type: ScriptType }>(SQL.SELECT_SCRIPT_TYPES, [scriptId]).map((row) => row.type);
}

/** 补齐脚本记录上的类型字段 */
function enrichScript(script: ProcessScript): ProcessScript {
  return { ...script, types: getScriptTypes(script.id) };
}

/** 按文件路径查询脚本并补齐类型 */
function getScriptByPath(filePath: string): ProcessScript {
  return enrichScript(queryOne<ProcessScript>(SQL.SELECT_SCRIPT_BY_PATH, [filePath])!);
}

/**
 * 新增或更新脚本，按文件路径去重。
 *
 * @param types 显式指定类型；省略时自动检测
 */
export function upsertScript(name: string, filePath: string, code: string, types?: ScriptType[]): ProcessScript {
  const resolvedTypes = types ?? detectScriptTypes(code);
  const existing = queryOne<ProcessScript>(SQL.SELECT_SCRIPT_BY_PATH, [filePath]);

  if (existing) {
    run(SQL.UPDATE_SCRIPT, [name, code, makeBrief(code), filePath]);
    replaceScriptTypes(existing.id, resolvedTypes);
  } else {
    const id = insert(SQL.INSERT_SCRIPT, [name, filePath, code, makeBrief(code)]);
    replaceScriptTypes(id, resolvedTypes);
  }
  return getScriptByPath(filePath);
}

/** 用新源码覆盖已入库的脚本，并重新检测类型 */
export function reloadScript(filePath: string, code: string): ProcessScript {
  const existing = queryOne<ProcessScript>(SQL.SELECT_SCRIPT_BY_PATH, [filePath]);
  run(SQL.RELOAD_SCRIPT, [code, makeBrief(code), filePath]);
  if (existing) {
    replaceScriptTypes(existing.id, detectScriptTypes(code));
  }
  return getScriptByPath(filePath);
}

/** 查询全部脚本，按名称升序 */
export function getAllScripts(): ProcessScript[] {
  return queryAll<ProcessScript>(SQL.SELECT_SCRIPTS_ALL).map(enrichScript);
}

/** 按 id 查询脚本 */
export function getScriptById(id: number): ProcessScript | undefined {
  const script = queryOne<ProcessScript>(SQL.SELECT_SCRIPT_BY_ID, [id]);
  return script ? enrichScript(script) : undefined;
}

/** 查询能处理指定类型的脚本，按名称升序 */
export function getScriptsByType(type: ScriptType): ProcessScript[] {
  return queryAll<ProcessScript>(SQL.SELECT_SCRIPTS_BY_TYPE, [type]).map(enrichScript);
}

/** 重命名脚本 */
export function renameScript(id: number, name: string): void {
  run(SQL.RENAME_SCRIPT, [name, id]);
}

/** 删除脚本及其类型关联 */
export function deleteScript(id: number): void {
  run(SQL.DELETE_SCRIPT_TYPES, [id]);
  run(SQL.DELETE_SCRIPT, [id]);
}

// ------------------------------------------------------------
// ProcessedImage
// ------------------------------------------------------------

/** 写入或更新图片组的选图结果，并把该图片组标记为已处理 */
export function upsertProcessedImage(
  imageGroupId: number,
  characterId: number,
  galleryId: number,
  originalPath: string,
  selectedFile: string,
  scriptId: number | null,
): ProcessedImage {
  const existing = queryOne<ProcessedImage>(SQL.SELECT_PROCESSED_BY_GROUP, [imageGroupId]);
  if (existing) {
    run(SQL.UPDATE_PROCESSED, [selectedFile, scriptId, imageGroupId]);
  } else {
    run(SQL.INSERT_PROCESSED, [
      imageGroupId, characterId, galleryId, originalPath, selectedFile, scriptId,
    ]);
  }
  run(SQL.UPDATE_IMAGE_GROUP_PROCESSED, [imageGroupId]);
  return queryOne<ProcessedImage>(SQL.SELECT_PROCESSED_BY_GROUP, [imageGroupId])!;
}

/** 查询准图库列表，可按图库与角色过滤 */
export function getAllProcessedImages(galleryId?: number, characterName?: string): ProcessedImageView[] {
  let sql = SQL.SELECT_PROCESSED_VIEW_BASE;
  const params: SqlValue[] = [];
  if (galleryId) {
    sql += ' AND pi.gallery_id = ?';
    params.push(galleryId);
  }
  if (characterName) {
    sql += ' AND c.name = ?';
    params.push(characterName);
  }
  return queryAll<ProcessedImageView>(`${sql} ORDER BY c.name`, params);
}

/** 删除准图库记录，并把对应图片组退回未处理 */
export function deleteProcessedImage(id: number): void {
  const row = queryOne<{ imageGroupId: number }>(SQL.SELECT_PROCESSED_BY_ID_GROUP, [id]);
  if (!row) {
    return;
  }
  run(SQL.DELETE_PROCESSED, [id]);
  run(SQL.UPDATE_IMAGE_GROUP_PENDING, [row.imageGroupId]);
}

// ------------------------------------------------------------
// IPC 调度
// ------------------------------------------------------------

/** 动态调度表：方法名与参数由渲染进程保证，这里只能放宽类型 */
type DbMethod = (...args: any[]) => unknown;

/** 暴露给渲染进程的数据库方法 */
const DB_METHODS: Record<string, DbMethod> = {
  beginBatch,
  endBatch,

  addGallery,
  getAllGalleries,
  clearGalleryData,
  deleteGallery,
  updateGalleryScannedAt,

  insertCharacter,
  getCharactersByGallery,
  renameCharacter,

  insertImageGroup,
  getImageGroupsView,
  updateImageGroupStatus,
  getImageFilesByGroup,
  getImageGroupIdByFilePath,

  insertImageFiles,

  upsertScript,
  reloadScript,
  getAllScripts,
  getScriptById,
  getScriptsByType,
  renameScript,
  deleteScript,

  upsertProcessedImage,
  getAllProcessedImages,
  deleteProcessedImage,
};

/** 注册数据库 IPC 通道 */
export function initDbIpc(): void {
  ipcMain.handle(IPC.DB, (_event, method: string, ...args: unknown[]) => {
    const handler = DB_METHODS[method];
    if (!handler) {
      throw new Error(`未知的数据库方法：${method}`);
    }
    return handler(...args);
  });
}
