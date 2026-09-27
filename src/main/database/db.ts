import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import { basename, join } from 'path';
import { app, ipcMain } from 'electron';
import { IPC } from '@common/ipcChannels';
import { compileScriptModule } from '@/script/compile';
import { BUILTIN_SCRIPT } from '@/script/defaults';
import type {
  Character, Source, ImageFile, ImageGroup, ImageGroupStatus, ImageGroupView,
  ProcessedImage, ProcessedImageView, ProcessScript, ScannedFile, ScriptType,
  MigrationProgress, SimilarData, SimilarGroup, TaskRow, TaskStatus, TaskType,
} from '@common/types';
import type { SimilarInputRow } from '@/image/similar';
import { runChangesets } from '@/database/changeset';
import type { MigrationOutcome } from '@/database/changeset';
import { initChangesetIpc } from '@/database/changeset-ipc';
import { CHANGELOG_FILES } from '@/database/changesets';
import { SQL } from '@/database/sql';

// ------------------------------------------------------------
// 常量
// ------------------------------------------------------------

/** 数据库文件名 */
const DB_FILE_NAME = 'picture-lib.db';

/** 脚本类型全集，用于检测脚本导出了哪些方法 */
const ALL_SCRIPT_TYPES: ScriptType[] = ['select-image', 'identify-character', 'identify-structure'];

/** 备份最小间隔：避免每次写入都复制整个数据库文件 */
const BACKUP_INTERVAL_MS = 30_000;

/** 可以绑定到语句上的值 */
type SqlValue = null | number | bigint | string | Uint8Array;

/** 脚本摘要长度 */
const BRIEF_MAX_LENGTH = 120;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

let db: DatabaseSync | null = null;
let dbPath = '';

/** 事务嵌套深度，大于 0 表示正处于一次事务中 */
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
 * 数据库目录：打包后在用户主目录的 `.plmanager/data/`，开发时在项目的 `dist/data/`。
 *
 * 打包态不能用 exe 同级：Windows 的「覆盖安装」会先静默调用旧版卸载器、清空整个安装目录；
 * Linux 的 deb 装在 root 所有的 `/opt/PLManager`，macOS 的 exe 在 `.app` 内部——都不是能写库的地方。
 */
function getDataDir(): string {
  return app.isPackaged
    ? join(homedir(), '.plmanager', 'data')
    : join(process.cwd(), 'dist', 'data');
}

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
}

/** 执行待处理的 changeset，并在动库之前留一份备份 */
export function runMigrations(
  onProgress: (progress: MigrationProgress) => void,
  shouldAbort?: () => boolean,
): Promise<MigrationOutcome> {
  return runChangesets({
    db: db!,
    dbPath,
    backupsDir: join(getDataDir(), 'backups'),
    files: CHANGELOG_FILES,
    onProgress,
    shouldAbort,
  });
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

/** 生成脚本列表展示用的代码摘要 */
function makeBrief(code: string): string {
  const brief = code.replace(/\n/g, '\\n').slice(0, BRIEF_MAX_LENGTH);
  return brief.length >= BRIEF_MAX_LENGTH ? `${brief}…` : brief;
}

/** 检测脚本导出了哪些可识别的方法 */
function detectScriptTypes(code: string): ScriptType[] {
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

/** 补齐脚本记录上的派生字段 */
function enrichScript(script: ProcessScript): ProcessScript {
  return {
    ...script,
    types: getScriptTypes(script.id),
    builtin: script.filePath === BUILTIN_SCRIPT.path,
  };
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
function upsertScript(name: string, filePath: string, code: string, types?: ScriptType[]): ProcessScript {
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
function reloadScript(filePath: string, code: string): ProcessScript {
  const existing = queryOne<ProcessScript>(SQL.SELECT_SCRIPT_BY_PATH, [filePath]);
  run(SQL.RELOAD_SCRIPT, [code, makeBrief(code), filePath]);
  if (existing) {
    replaceScriptTypes(existing.id, detectScriptTypes(code));
  }
  return getScriptByPath(filePath);
}

/** 从磁盘导入脚本：主进程读取源码并入库，名称取文件名 */
export function importScript(filePath: string): ProcessScript {
  return upsertScript(basename(filePath), filePath, readFileSync(filePath, 'utf-8'));
}

/** 用磁盘上的最新内容重新载入已入库的脚本 */
export function reloadScriptFromFile(filePath: string): ProcessScript {
  return reloadScript(filePath, readFileSync(filePath, 'utf-8'));
}

/**
 * 播种内置默认脚本：库里还没有这一条时插入，已有则原样不动。
 *
 * 它不允许删除，所以插过一次就一直在——不需要额外的「已播种」标记，
 * 也不会覆盖使用者改过的代码。
 */
export function seedBuiltinScript(): void {
  if (queryOne<ProcessScript>(SQL.SELECT_SCRIPT_BY_PATH, [BUILTIN_SCRIPT.path])) {
    return;
  }
  upsertScript(BUILTIN_SCRIPT.name, BUILTIN_SCRIPT.path, BUILTIN_SCRIPT.source);
}

/** 用随应用发布的内置源码覆盖内置脚本；名字是使用者的，不动 */
export function resetBuiltinScript(id: number): ProcessScript {
  const script = getScriptById(id);
  if (!script?.builtin) {
    throw new Error('只有内置脚本可以恢复默认');
  }
  return reloadScript(BUILTIN_SCRIPT.path, BUILTIN_SCRIPT.source);
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

/** 删除脚本及其类型关联；内置脚本不允许删除 */
export function deleteScript(id: number): void {
  if (getScriptById(id)?.builtin) {
    throw new Error('内置脚本不能删除');
  }
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
  sourceId: number,
  originalPath: string,
  selectedFile: string,
  scriptId: number | null,
): ProcessedImage {
  const existing = queryOne<ProcessedImage>(SQL.SELECT_PROCESSED_BY_GROUP, [imageGroupId]);
  if (existing) {
    run(SQL.UPDATE_PROCESSED, [selectedFile, scriptId, imageGroupId]);
  } else {
    run(SQL.INSERT_PROCESSED, [
      imageGroupId, characterId, sourceId, originalPath, selectedFile, scriptId,
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

  importScript,
  reloadScriptFromFile,
  getAllScripts,
  getScriptsByType,
  renameScript,
  deleteScript,
  resetBuiltinScript,

  upsertProcessedImage,
  getAllProcessedImages,
  deleteProcessedImage,
};

/** 注册数据库相关的全部 IPC 通道，含加载页用的那三条 changelog 通道 */
export function initDbIpc(): void {
  initChangesetIpc();

  ipcMain.handle(IPC.DB, (_event, method: string, ...args: unknown[]) => {
    const handler = DB_METHODS[method];
    if (!handler) {
      throw new Error(`未知的数据库方法：${method}`);
    }
    return handler(...args);
  });
}
