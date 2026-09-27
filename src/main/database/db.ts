import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, join } from 'path';
import { ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import type {
  Character, Source, ImageFile, ImageGroup, ImageGroupStatus, ImageGroupView,
  ProcessedImage, ProcessedImageView, ProcessScript, ScannedFile, ScriptType,
  SimilarData, SimilarGroup, TaskRow, TaskStatus, TaskType,
} from '@common/types';
import type { SimilarInputRow } from '@/image/similar';
import { SQL } from '@/database/sql';
import { getDataDir } from '@/paths';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/** 数据库文件名 */
const DB_FILE_NAME = 'picture-lib.db';

/** 备份最小间隔：避免每次写入都复制整个数据库文件 */
const BACKUP_INTERVAL_MS = 30_000;

/** 可以绑定到语句上的值 */
type SqlValue = null | number | bigint | string | Uint8Array;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

let db: DatabaseSync | null = null;
let dbPath = '';

/**
 * 事务嵌套深度：大于 0 表示正处在一次事务里。
 *
 * **它是「当前有没有事务」的唯一状态**：`beginBatch()` / `endBatch()` 与
 * `runInMigrationTransaction()` 都先占住它，所以后者套前者（或反过来）会像 Spring 的
 * `PROPAGATION_REQUIRED` 那样并入外层，而不是再发一个 `BEGIN`（SQLite 会直接拒绝）。
 * 新增任何事务入口都必须先经过这个计数器，否则就会绕开它、重现「事务里开事务」。
 */
let batchDepth = 0;

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

/**
 * 缩略图在库里是 BLOB（WebP 原始字节）。
 *
 * 界面需要的是能直接塞进 `<img src>` 的 data URL，转换只在这一处做，
 * 调用方拿到的永远是字符串——库里存字节、出口是字符串。
 */
function thumbnailToDataUrl(value: unknown): unknown {
  if (!(value instanceof Uint8Array)) {
    return value;
  }
  return `data:image/webp;base64,${Buffer.from(value).toString('base64')}`;
}

/** 读出来的行统一整形：缩略图字节转成 data URL */
function shapeRow<T>(row: Record<string, unknown>): T {
  const shaped = snakeToCamel(row);
  if ('thumbnail' in shaped) {
    shaped.thumbnail = thumbnailToDataUrl(shaped.thumbnail);
  }
  if ('selectedFileThumbnail' in shaped) {
    shaped.selectedFileThumbnail = thumbnailToDataUrl(shaped.selectedFileThumbnail);
  }
  return shaped as unknown as T;
}

/** 执行 SELECT 并返回全部行 */
function queryAll<T>(sql: string, params: SqlValue[] = []): T[] {
  return db!.prepare(sql).all(...params).map((row) => shapeRow<T>(row as Record<string, unknown>));
}

/** 执行 SELECT 并返回首行，无结果时返回 undefined */
function queryOne<T>(sql: string, params: SqlValue[] = []): T | undefined {
  const row = db!.prepare(sql).get(...params);
  return row ? shapeRow<T>(row as Record<string, unknown>) : undefined;
}

/** 执行一条写语句（INSERT / UPDATE / DELETE） */
function run(sql: string, params: SqlValue[] = []): void {
  db!.prepare(sql).run(...params);
  backupDatabase();
}

/** 执行一条 INSERT 并返回新行的 rowid */
function insert(sql: string, params: SqlValue[] = []): number {
  const result = db!.prepare(sql).run(...params);
  backupDatabase();
  return Number(result.lastInsertRowid);
}

// ------------------------------------------------------------
// 底层：备份
// ------------------------------------------------------------

/**
 * 按 {@link BACKUP_INTERVAL_MS} 复制一份数据库文件，供误操作兜底。
 *
 * 复制前先做一次 FULL checkpoint，把 WAL 里的改动落回主文件，
 * 否则复制出来的可能缺最近几次事务。
 */
function backupDatabase(): void {
  if (!db || !existsSync(dbPath)) {
    return;
  }
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_INTERVAL_MS) {
    return;
  }

  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
    copyFileSync(dbPath, `${dbPath}.bak`);
    lastBackupAt = now;
  } catch (error) {
    console.error('[db] 备份失败：', error);
  }
}

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

/**
 * 打开（必要时创建）数据库文件。
 *
 * 只负责开库与 pragma，不改动任何结构：结构由 changelog 里的 changeset 演进。
 * 用 Node 内置的 SQLite：库是真实文件，单条 INSERT 只追加 WAL。
 */
export function initDatabase(): void {
  const dataDir = getDataDir();
  console.log('[db] 数据目录：', dataDir);

  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    throw new Error(`数据目录不可用：${dataDir}（${error instanceof Error ? error.message : String(error)}）`);
  }
  dbPath = join(dataDir, DB_FILE_NAME);

  try {
    db = new DatabaseSync(dbPath);
  } catch (error) {
    throw new Error(`打不开数据库：${dbPath}（${error instanceof Error ? error.message : String(error)}）`);
  }
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');

  // 数据库相关的初始化只在这一个函数里：开库 + 注册 DB 通道
  registerDbIpc();
}

/** 关闭数据库，供退出前调用；WAL 会在关闭时合并回主文件 */
export function closeDatabase(): void {
  if (!db) {
    return;
  }
  try {
    db.close();
  } catch (error) {
    console.error('[db] 关闭数据库失败：', error);
  }
  db = null;
}

// ------------------------------------------------------------
// 升级模块的接口
// ------------------------------------------------------------

/** 账本里的一行 */
export interface MigrationLedgerRow {
  author: string;
  id: string;
  filename: string;
  exectype: string;
  /** 全局执行序号，用来算下一个序号 */
  orderExecuted: number;
}

/** 要写进账本的一行 */
export interface MigrationLedgerEntry {
  author: string;
  id: string;
  filename: string;
  title: string;
  exectype: 'executed' | 'failed';
  order: number;
  executionMs: number;
}

/** 库文件路径：升级模块备份时要用 */
export function getDbPath(): string {
  return dbPath;
}

/** 在库上执行一段 SQL：升级模块用它跑迁移 SQL、建账本、做 checkpoint */
export function execSql(sql: string): void {
  db!.exec(sql);
}

/**
 * 把一段回调包进一个事务：要么全做、要么全不做。
 *
 * 与 beginBatch / endBatch 不是一回事：那条路径不接受回滚，这里要的是失败时整体回滚。
 * 回调可以是异步的（升级脚本就是异步的）。
 */
export async function runInMigrationTransaction<T>(fn: () => T | Promise<T>): Promise<T> {
  if (batchDepth > 0) {
    // 迁移只应该是最外层（它在启动阶段跑，那时还没有任何任务）；跑在别的批里说明用错了地方
    throw new Error('迁移事务不能嵌套在别的事务里：先结束那次批处理再升级');
  }

  const handle = db!;
  handle.exec('BEGIN');
  // 也占住嵌套计数器：升级脚本里若调到 beginBatch()/endBatch()（例如 renameScript），
  // 那一次就该退化成「嵌套」而不是再发一个 BEGIN——SQLite 不允许事务里再开事务
  batchDepth += 1;
  try {
    const result = await fn();
    batchDepth -= 1;
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    batchDepth -= 1;
    handle.exec('ROLLBACK');
    throw error;
  }
}

/** 读账本：「跑过没有」由升级模块按身份判断 */
export function readMigrationLedger(): MigrationLedgerRow[] {
  return queryAll<MigrationLedgerRow>(SQL.SELECT_MIGRATION_LEDGER);
}

/**
 * 写一条账本记录。
 *
 * 不走 run()：那条路径会按 BACKUP_INTERVAL_MS 触发一次整库复制，升级过程中不需要再来一次
 * ——升级自己已经在开始前备份过。
 */
export function writeMigrationLedger(entry: MigrationLedgerEntry): void {
  db!
    .prepare(SQL.WRITE_MIGRATION_LEDGER)
    .run(entry.author, entry.id, entry.filename, entry.title, entry.exectype, entry.order, entry.executionMs);
}

// ------------------------------------------------------------
// 批量提交
// ------------------------------------------------------------

/** 开始一次事务：期间的多条写入合并成一次提交 */
export function beginBatch(): void {
  batchDepth += 1;
  if (batchDepth === 1) {
    db!.exec('BEGIN');
  }
}

/** 结束一次事务：嵌套归零时提交 */
export function endBatch(): void {
  if (batchDepth === 0) {
    return;
  }
  batchDepth -= 1;
  if (batchDepth > 0) {
    return;
  }

  try {
    db!.exec('COMMIT');
  } catch (error) {
    db!.exec('ROLLBACK');
    throw error;
  }
  backupDatabase();
}

// ------------------------------------------------------------
// Source
// ------------------------------------------------------------

/** 新增来源，名称取目录名；root_path 重复时由 SQLite 抛出唯一约束错误 */
export function addSource(rootPath: string): Source {
  const id = insert(SQL.INSERT_SOURCE, [basename(rootPath), rootPath]);
  return queryOne<Source>(SQL.SELECT_SOURCE_BY_ID, [id])!;
}

/** 按 id 查询来源 */
export function getSourceById(id: number): Source | undefined {
  return queryOne<Source>(SQL.SELECT_SOURCE_BY_ID, [id]);
}

/** 查询全部来源，按创建时间倒序 */
export function getAllSources(): Source[] {
  return queryAll<Source>(SQL.SELECT_SOURCE_ALL);
}

/** 清空来源下的全部扫描数据，保留来源本身，用于重新扫描 */
export function clearSourceData(sourceId: number): void {
  run(SQL.DELETE_PROCESSED_BY_SOURCE, [sourceId]);
  run(SQL.DELETE_IMAGE_FILES_BY_SOURCE, [sourceId]);
  run(SQL.DELETE_IMAGE_GROUPS_BY_SOURCE, [sourceId]);
  run(SQL.DELETE_CHARACTERS_BY_SOURCE, [sourceId]);
}

/** 删除来源及其全部扫描数据 */
export function deleteSource(sourceId: number): void {
  clearSourceData(sourceId);
  run(SQL.DELETE_SOURCE, [sourceId]);
}

/** 记录来源最近一次扫描完成时间 */
export function updateSourceScannedAt(sourceId: number): void {
  run(SQL.UPDATE_SOURCE_SCAN, [sourceId]);
}

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

/** 写入角色；同来源下同名已存在时忽略并返回既有记录 */
export function insertCharacter(sourceId: number, name: string, sourcePath: string): Character {
  run(SQL.INSERT_CHARACTER, [sourceId, name, sourcePath]);
  return queryOne<Character>(SQL.SELECT_CHARACTER_BY_SOURCE_NAME, [sourceId, name])!;
}

/** 查询来源下的角色，按名称升序 */
export function getCharactersBySource(sourceId: number): Character[] {
  return queryAll<Character>(SQL.SELECT_CHARACTERS_BY_SOURCE, [sourceId]);
}

/** 重命名角色；与同来源内的角色重名时抛出可读错误 */
export function renameCharacter(id: number, name: string): void {
  try {
    run(SQL.RENAME_CHARACTER, [name, id]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(`角色「${name}」已存在于当前来源`);
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

/** 查询图片组列表，可按状态与来源过滤 */
export function getImageGroupsView(status?: ImageGroupStatus, sourceId?: number): ImageGroupView[] {
  let sql = SQL.SELECT_IMAGE_GROUPS_VIEW_BASE;
  const params: SqlValue[] = [];
  if (status) {
    sql += ' AND ig.status = ?';
    params.push(status);
  }
  if (sourceId) {
    sql += ' AND g.id = ?';
    params.push(sourceId);
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

// ------------------------------------------------------------
// 相似图片识别结果
// ------------------------------------------------------------

/** 结果表 join image_file 之后的一行 */
interface SimilarRow {
  groupId: number;
  kind: string;
  filePath: string;
  fileName: string | null;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  distance: number;
}

/** 「图库」页的图片（每个图片组选定的那一张）及其感知哈希 */
export function getSimilarInputRows(): SimilarInputRow[] {
  return queryAll<SimilarInputRow>(SQL.SELECT_SIMILAR_INPUT);
}

/** 清空上一次识别结果：结果表只保留最近一次，避免无限增长 */
export function clearSimilarData(): void {
  run(SQL.CLEAR_SIMILAR_MEMBERS);
  run(SQL.CLEAR_SIMILAR_GROUPS);
  run(SQL.CLEAR_SIMILAR_RUNS);
}

/** 写入一次识别的统计，返回 run id */
export function insertSimilarRun(compared: number, skipped: number): number {
  return insert(SQL.INSERT_SIMILAR_RUN, [compared, skipped]);
}

/** 写入一个结果组，返回 group id */
export function insertSimilarGroup(runId: number, kind: string, size: number): number {
  return insert(SQL.INSERT_SIMILAR_GROUP, [runId, kind, size]);
}

/** 写入结果组里的一个成员 */
export function insertSimilarMember(groupId: number, filePath: string, distance: number): void {
  run(SQL.INSERT_SIMILAR_MEMBER, [groupId, filePath, distance]);
}

/** 读取最近一次识别结果；一次都没跑过时返回 null */
export function getSimilarData(): SimilarData | null {
  const latest = queryOne<{ compared: number; skipped: number }>(SQL.SELECT_SIMILAR_RUN_LATEST);
  if (!latest) {
    return null;
  }

  const groups = new Map<number, SimilarGroup>();
  for (const row of queryAll<SimilarRow>(SQL.SELECT_SIMILAR_GROUPS)) {
    let group = groups.get(row.groupId);
    if (!group) {
      group = { kind: row.kind === 'similar' ? 'similar' : 'same', members: [] };
      groups.set(row.groupId, group);
    }
    group.members.push({
      filePath: row.filePath,
      fileName: row.fileName ?? '',
      thumbnail: row.thumbnail,
      width: row.width,
      height: row.height,
      distance: row.distance,
    });
  }

  const all = [...groups.values()];
  return {
    same: all.filter((group) => group.kind === 'same'),
    similar: all.filter((group) => group.kind === 'similar'),
    compared: latest.compared,
    skipped: latest.skipped,
  };
}

/** 按 id 批量查询图片组视图，用于批量选图任务提交时固化的快照 */
export function getImageGroupsViewByIds(ids: number[]): ImageGroupView[] {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  return queryAll<ImageGroupView>(
    `${SQL.SELECT_IMAGE_GROUPS_VIEW_BASE} AND ig.id IN (${placeholders})`,
    ids,
  );
}

/** 按文件路径反查所属图片组；文件不在来源中时返回 null */
export function getImageGroupIdByFilePath(filePath: string): number | null {
  const row = queryOne<{ imageGroupId: number }>(SQL.SELECT_GROUP_ID_BY_FILE_PATH, [filePath]);
  return row?.imageGroupId ?? null;
}

// ------------------------------------------------------------
// ImageFile
// ------------------------------------------------------------

/** 写入图片组内的图片文件；同路径的行会被忽略 */
export function insertImageFiles(groupId: number, files: ScannedFile[]): void {
  for (const file of files) {
    run(SQL.INSERT_IMAGE_FILE, [
      groupId, file.fileName, file.filePath, file.fileSize,
      file.width ?? 0, file.height ?? 0, file.extension, file.thumbnail, file.phash,
    ]);
  }
}

// ------------------------------------------------------------
// ProcessScript
// ------------------------------------------------------------

/** 覆盖脚本的类型关联；类型由上层（script/library.ts）编译检测后传进来 */
export function setScriptTypes(scriptId: number, types: ScriptType[]): void {
  run(SQL.DELETE_SCRIPT_TYPES, [scriptId]);
  for (const type of types) {
    run(SQL.INSERT_SCRIPT_TYPE, [scriptId, type]);
  }
}

/** 读取脚本的类型关联 */
function getScriptTypes(scriptId: number): ScriptType[] {
  return queryAll<{ type: ScriptType }>(SQL.SELECT_SCRIPT_TYPES, [scriptId]).map((row) => row.type);
}

/** 行原始形态：SQLite 把 builtin 存成 0/1，视图要的是 boolean */
interface ScriptRow {
  id: number;
  name: string;
  filePath: string;
  builtin: number;
  loadedAt: string;
  createdAt: string;
}

/** 补齐脚本记录上的派生字段：类型关联与内置标记 */
function enrichScript(row: ScriptRow): ProcessScript {
  return { ...row, builtin: row.builtin === 1, types: getScriptTypes(row.id) };
}

/** 查询全部脚本，按名称升序 */
export function getAllScripts(): ProcessScript[] {
  return queryAll<ScriptRow>(SQL.SELECT_SCRIPTS_ALL).map(enrichScript);
}

/** 按 id 查询脚本 */
export function getScriptById(id: number): ProcessScript | undefined {
  const row = queryOne<ScriptRow>(SQL.SELECT_SCRIPT_BY_ID, [id]);
  return row ? enrichScript(row) : undefined;
}

/** 按文件路径查询脚本；升级脚本用它判断「这一条是不是已经在了」 */
export function getScriptByPath(filePath: string): ProcessScript | undefined {
  const row = queryOne<ScriptRow>(SQL.SELECT_SCRIPT_BY_PATH, [filePath]);
  return row ? enrichScript(row) : undefined;
}

/** 查询内置脚本；「恢复默认」与内置落盘都靠它 */
export function getBuiltinScript(): ProcessScript | undefined {
  const row = queryOne<ScriptRow>(SQL.SELECT_SCRIPT_BUILTIN);
  return row ? enrichScript(row) : undefined;
}

/** 按类型查询脚本，按名称升序 */
export function getScriptsByType(type: ScriptType): ProcessScript[] {
  return queryAll<ScriptRow>(SQL.SELECT_SCRIPTS_BY_TYPE, [type]).map(enrichScript);
}

/** 插入一个脚本行；正文不进库，所以这里只收名称与文件路径 */
export function insertScript(name: string, filePath: string, builtin: boolean): ProcessScript {
  const id = insert(SQL.INSERT_SCRIPT, [name, filePath, builtin ? 1 : 0]);
  return getScriptById(id)!;
}

/**
 * 改名。
 *
 * 同一个事务里把图库里的名字副本一起改掉：那一列存的是「这个脚本叫什么」，
 * 改名后图库必须跟着显示新名字（删除时则不动，名字成为最后一份记录）。
 */
export function renameScript(id: number, name: string): void {
  beginBatch();
  try {
    run(SQL.RENAME_SCRIPT, [name, id]);
    run(SQL.RENAME_PROCESSED_SCRIPT_NAME, [name, id]);
  } finally {
    endBatch();
  }
}

/** 回填脚本文件路径：接管旧脚本与内置脚本落盘用 */
export function setScriptFilePath(id: number, filePath: string): void {
  run(SQL.SET_SCRIPT_FILE_PATH, [filePath, id]);
}

/** 只更新时间戳：用同一份文件重新载入时用 */
export function touchScriptLoadedAt(id: number): void {
  run(SQL.TOUCH_SCRIPT_LOADED_AT, [id]);
}

/** 图库里有几条记录来自这个脚本 */
export function countProcessedByScript(id: number): number {
  return queryOne<{ processed: number }>(SQL.COUNT_PROCESSED_BY_SCRIPT, [id])?.processed ?? 0;
}

/** 删脚本行与它的类型关联；内置能不能删由上层判断——那是编排，不归这里 */
export function deleteScriptRows(id: number): void {
  run(SQL.DELETE_SCRIPT_TYPES, [id]);
  run(SQL.DELETE_SCRIPT, [id]);
}

/** 老库接管：库里还有没有 code 列——这一列的存在本身就是「还没接管」的标记 */
export function hasScriptCodeColumn(): boolean {
  const columns = queryAll<{ name: string }>('PRAGMA table_info(process_script)');
  return columns.some((column) => column.name === 'code');
}

/** 老库接管：把每一条的旧源码读出来 */
export function listLegacyScriptSources(): { id: number; name: string; filePath: string; code: string }[] {
  return queryAll<{ id: number; name: string; filePath: string; code: string }>(SQL.SELECT_LEGACY_SCRIPTS);
}


// ------------------------------------------------------------
// ProcessedImage
// ------------------------------------------------------------

/** 写入或更新图片组的选图结果，并把该图片组标记为已处理 */
export function upsertProcessedImage(
  imageGroupId: number,
  characterId: number,
  sourceId: number,
  originalPath: string,
  selectedFile: string,
  scriptId: number | null,
): ProcessedImage {
  const existing = queryOne<ProcessedImage>(SQL.SELECT_PROCESSED_BY_GROUP, [imageGroupId]);
  if (existing) {
    run(SQL.UPDATE_PROCESSED, [selectedFile, scriptId, scriptId, imageGroupId]);
  } else {
    run(SQL.INSERT_PROCESSED, [
      imageGroupId, characterId, sourceId, originalPath, selectedFile, scriptId, scriptId,
    ]);
  }
  run(SQL.UPDATE_IMAGE_GROUP_PROCESSED, [imageGroupId]);
  return queryOne<ProcessedImage>(SQL.SELECT_PROCESSED_BY_GROUP, [imageGroupId])!;
}

/** 查询图库列表，可按来源与角色过滤 */
export function getAllProcessedImages(sourceId?: number, characterName?: string): ProcessedImageView[] {
  let sql = SQL.SELECT_PROCESSED_VIEW_BASE;
  const params: SqlValue[] = [];
  if (sourceId) {
    sql += ' AND pi.source_id = ?';
    params.push(sourceId);
  }
  if (characterName) {
    sql += ' AND c.name = ?';
    params.push(characterName);
  }
  return queryAll<ProcessedImageView>(`${sql} ORDER BY c.name`, params);
}

/** 导出任务唯一需要的字段 */
export interface ProcessedExportRow {
  id: number;
  selectedFile: string;
  characterName: string;
}

/** 按 id 批量查询导出所需的图库记录 */
export function getProcessedForExport(ids: number[]): ProcessedExportRow[] {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  return queryAll<ProcessedExportRow>(
    `${SQL.SELECT_PROCESSED_EXPORT_BASE} AND pi.id IN (${placeholders})`,
    ids,
  );
}

/** 删除图库记录，并把对应图片组退回未处理 */
export function deleteProcessedImage(id: number): void {
  const row = queryOne<{ imageGroupId: number }>(SQL.SELECT_PROCESSED_BY_ID_GROUP, [id]);
  if (!row) {
    return;
  }
  run(SQL.DELETE_PROCESSED, [id]);
  run(SQL.UPDATE_IMAGE_GROUP_PENDING, [row.imageGroupId]);
}

// ------------------------------------------------------------
// Task
// ------------------------------------------------------------

/** 新建任务并返回其 id */
export function insertTask(type: TaskType, queueOrder: number, payload: string): number {
  return insert(SQL.INSERT_TASK, [type, queueOrder, payload]);
}

/** 按 id 查询任务 */
export function getTaskRow(id: number): TaskRow | undefined {
  return queryOne<TaskRow>(SQL.SELECT_TASK_BY_ID, [id]);
}

/** 查询全部任务，按入队顺序排列 */
export function getAllTasks(): TaskRow[] {
  return queryAll<TaskRow>(SQL.SELECT_TASKS_ALL);
}

/** 当前最大的入队序号，用于把新任务排到队尾 */
export function getMaxQueueOrder(): number {
  const row = queryOne<{ maxQueueOrder: number }>(SQL.SELECT_MAX_QUEUE_ORDER);
  return Number(row?.maxQueueOrder ?? 0);
}

/** 任务开始执行 */
export function markTaskRunning(id: number, message: string): void {
  run(SQL.UPDATE_TASK_RUNNING, [message, id]);
}

/** 被暂停的任务恢复执行，不刷新 started_at */
export function resumeTask(id: number): void {
  run(SQL.UPDATE_TASK_RESUME, [id]);
}

/** 任务暂停 */
export function markTaskPaused(id: number): void {
  run(SQL.UPDATE_TASK_PAUSED, [id]);
}

/** 更新进度与阶段描述 */
export function updateTaskProgress(id: number, progress: number, message: string): void {
  run(SQL.UPDATE_TASK_PROGRESS, [progress, message, id]);
}

/** 写入终态 */
export function finishTask(
  id: number,
  status: TaskStatus,
  progress: number,
  message: string,
  result: string,
  error: string,
): void {
  run(SQL.UPDATE_TASK_FINISHED, [status, progress, message, result, error, id]);
}

/** 调整任务在队列中的顺序 */
export function updateTaskQueueOrder(id: number, queueOrder: number): void {
  run(SQL.UPDATE_TASK_QUEUE_ORDER, [queueOrder, id]);
}

/** 清空全部终态任务 */
export function deleteFinishedTasks(): void {
  run(SQL.DELETE_TASKS_FINISHED);
}

// ------------------------------------------------------------
// IPC 调度
// ------------------------------------------------------------

/** 动态调度表：方法名与参数由渲染进程保证，这里只能放宽类型 */
type DbMethod = (...args: any[]) => unknown;

/** 暴露给渲染进程的数据库方法 */
const DB_METHODS: Record<string, DbMethod> = {
  addSource,
  getAllSources,
  clearSourceData,
  deleteSource,

  getCharactersBySource,
  renameCharacter,

  getImageGroupsView,
  updateImageGroupStatus,
  getImageFilesByGroup,
  getImageGroupIdByFilePath,

  getAllScripts,
  getScriptsByType,
  renameScript,

  upsertProcessedImage,
  getAllProcessedImages,
  deleteProcessedImage,
};

/**
 * 注册数据库通道。
 *
 * 加载页那几条通道不在这里：它们归加载服务（见 loading/progress.ts），由 initLoadingIpc() 注册。
 * 本函数由 initDatabase() 调用——数据库的初始化只有那一个入口。
 */
function registerDbIpc(): void {
  ipcMain.handle(IPC.DB, (_event, method: string, ...args: unknown[]) => {
    const handler = DB_METHODS[method];
    if (!handler) {
      throw new Error(`未知的数据库方法：${method}`);
    }
    return handler(...args);
  });
}
