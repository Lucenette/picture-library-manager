// ============================================================
// SQL 常量 —— 所有语句集中管理，业务代码只负责拼接过滤条件
// ============================================================

/**
 * 全部 SQL 语句。
 *
 * 以 `_VIEW_BASE` 结尾的是列表查询的基语句，调用方需要自行追加 WHERE
 * 与 ORDER BY；其余都是可直接执行的完整语句。
 */
export const SQL = {
  // ----------------------------------------------------------
  // 建表
  // ----------------------------------------------------------

  CREATE_GALLERY: `CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`,

  CREATE_CHARACTER: `CREATE TABLE IF NOT EXISTS character (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(gallery_id, name)
)`,

  CREATE_IMAGE_GROUP: `CREATE TABLE IF NOT EXISTS image_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  dir_name TEXT NOT NULL,
  dir_path TEXT NOT NULL UNIQUE,
  file_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','excluded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`,

  CREATE_IMAGE_FILE: `CREATE TABLE IF NOT EXISTS image_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_group_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  extension TEXT NOT NULL,
  thumbnail BLOB,
  phash BLOB,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`,

  CREATE_PROCESS_SCRIPT: `CREATE TABLE IF NOT EXISTS process_script (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  loaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`,

  CREATE_SCRIPT_TYPE: `CREATE TABLE IF NOT EXISTS script_type (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  UNIQUE(script_id, type)
)`,

  CREATE_PROCESSED_IMAGE: `CREATE TABLE IF NOT EXISTS processed_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_group_id INTEGER NOT NULL UNIQUE,
  character_id INTEGER NOT NULL,
  gallery_id INTEGER NOT NULL,
  original_path TEXT NOT NULL,
  selected_file TEXT NOT NULL,
  script_id INTEGER,
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`,

  CREATE_INDEX_IMAGE_FILE_GROUP: 'CREATE INDEX IF NOT EXISTS idx_image_file_group ON image_file(image_group_id)',
  CREATE_INDEX_PROCESSED_CHARACTER: 'CREATE INDEX IF NOT EXISTS idx_processed_character ON processed_image(character_id)',
  CREATE_INDEX_PROCESSED_GALLERY: 'CREATE INDEX IF NOT EXISTS idx_processed_gallery ON processed_image(gallery_id)',

  // ----------------------------------------------------------
  // Gallery
  // ----------------------------------------------------------

  INSERT_GALLERY: 'INSERT INTO gallery (name, root_path) VALUES (?, ?)',
  SELECT_GALLERY_ALL: 'SELECT * FROM gallery ORDER BY created_at DESC',
  SELECT_GALLERY_BY_ID: 'SELECT * FROM gallery WHERE id = ?',
  DELETE_GALLERY: 'DELETE FROM gallery WHERE id = ?',
  UPDATE_GALLERY_SCAN: "UPDATE gallery SET scanned_at = datetime('now','localtime') WHERE id = ?",

  // 删除图库时按依赖逆序手工级联清理
  DELETE_PROCESSED_BY_GALLERY: 'DELETE FROM processed_image WHERE gallery_id = ?',
  DELETE_IMAGE_FILES_BY_GALLERY: `DELETE FROM image_file WHERE image_group_id IN (
  SELECT id FROM image_group WHERE character_id IN (SELECT id FROM character WHERE gallery_id = ?)
)`,
  DELETE_IMAGE_GROUPS_BY_GALLERY: `DELETE FROM image_group WHERE character_id IN (
  SELECT id FROM character WHERE gallery_id = ?
)`,
  DELETE_CHARACTERS_BY_GALLERY: 'DELETE FROM character WHERE gallery_id = ?',

  // ----------------------------------------------------------
  // Character
  // ----------------------------------------------------------

  INSERT_CHARACTER: 'INSERT OR IGNORE INTO character (gallery_id, name, source_path) VALUES (?, ?, ?)',
  SELECT_CHARACTER_BY_GALLERY_NAME: 'SELECT * FROM character WHERE gallery_id = ? AND name = ?',
  SELECT_CHARACTERS_BY_GALLERY: 'SELECT * FROM character WHERE gallery_id = ? ORDER BY name',
  RENAME_CHARACTER: 'UPDATE character SET name = ? WHERE id = ?',

  // ----------------------------------------------------------
  // ImageGroup
  // ----------------------------------------------------------

  INSERT_IMAGE_GROUP: 'INSERT OR IGNORE INTO image_group (character_id, dir_name, dir_path, file_count) VALUES (?, ?, ?, ?)',
  SELECT_IMAGE_GROUP_BY_PATH: 'SELECT * FROM image_group WHERE dir_path = ?',
  UPDATE_IMAGE_GROUP_STATUS: 'UPDATE image_group SET status = ? WHERE id = ?',
  UPDATE_IMAGE_GROUP_PROCESSED: "UPDATE image_group SET status = 'processed' WHERE id = ?",
  UPDATE_IMAGE_GROUP_PENDING: "UPDATE image_group SET status = 'pending' WHERE id = ?",

  /** 图片组列表基语句，调用方按需追加 WHERE 与 ORDER BY */
  SELECT_IMAGE_GROUPS_VIEW_BASE: `SELECT ig.*, c.name AS characterName, g.name AS galleryName, g.id AS galleryId
  FROM image_group ig
  JOIN character c ON ig.character_id = c.id
  JOIN gallery g ON c.gallery_id = g.id
  WHERE 1 = 1`,

  // ----------------------------------------------------------
  // ImageFile
  // ----------------------------------------------------------

  INSERT_IMAGE_FILE: 'INSERT OR IGNORE INTO image_file (image_group_id, file_name, file_path, file_size, width, height, extension, thumbnail, phash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  SELECT_IMAGE_FILES_BY_GROUP: 'SELECT * FROM image_file WHERE image_group_id = ? ORDER BY file_name',
  SELECT_GROUP_ID_BY_FILE_PATH: 'SELECT image_group_id FROM image_file WHERE file_path = ?',

  // ----------------------------------------------------------
  // ProcessScript
  // ----------------------------------------------------------

  INSERT_SCRIPT: "INSERT INTO process_script (name, file_path, code, brief, loaded_at) VALUES (?, ?, ?, ?, datetime('now','localtime'))",
  SELECT_SCRIPT_BY_PATH: 'SELECT * FROM process_script WHERE file_path = ?',
  SELECT_SCRIPT_BY_ID: 'SELECT * FROM process_script WHERE id = ?',
  SELECT_SCRIPTS_ALL: 'SELECT * FROM process_script ORDER BY name',
  UPDATE_SCRIPT: "UPDATE process_script SET name = ?, code = ?, brief = ?, loaded_at = datetime('now','localtime') WHERE file_path = ?",
  RELOAD_SCRIPT: "UPDATE process_script SET code = ?, brief = ?, loaded_at = datetime('now','localtime') WHERE file_path = ?",
  RENAME_SCRIPT: 'UPDATE process_script SET name = ? WHERE id = ?',
  DELETE_SCRIPT: 'DELETE FROM process_script WHERE id = ?',

  DELETE_SCRIPT_TYPES: 'DELETE FROM script_type WHERE script_id = ?',
  INSERT_SCRIPT_TYPE: 'INSERT OR IGNORE INTO script_type (script_id, type) VALUES (?, ?)',
  SELECT_SCRIPT_TYPES: 'SELECT type FROM script_type WHERE script_id = ?',
  SELECT_SCRIPTS_BY_TYPE: `SELECT DISTINCT ps.* FROM process_script ps
  JOIN script_type st ON ps.id = st.script_id
  WHERE st.type = ?
  ORDER BY ps.name`,

  // ----------------------------------------------------------
  // ProcessedImage
  // ----------------------------------------------------------

  INSERT_PROCESSED: "INSERT INTO processed_image (image_group_id, character_id, gallery_id, original_path, selected_file, script_id, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
  SELECT_PROCESSED_BY_GROUP: 'SELECT * FROM processed_image WHERE image_group_id = ?',
  SELECT_PROCESSED_BY_ID_GROUP: 'SELECT image_group_id FROM processed_image WHERE id = ?',
  UPDATE_PROCESSED: "UPDATE processed_image SET selected_file = ?, script_id = ?, confirmed_at = datetime('now','localtime') WHERE image_group_id = ?",
  DELETE_PROCESSED: 'DELETE FROM processed_image WHERE id = ?',
  DELETE_PROCESSED_BY_GROUP: 'DELETE FROM processed_image WHERE image_group_id = ?',

  /** 导出任务用的精简查询，只取需要的列，不带缩略图 */
  SELECT_PROCESSED_EXPORT_BASE: `SELECT pi.id, pi.selected_file, c.name AS characterName
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  WHERE 1 = 1`,

  // ----------------------------------------------------------
  // 后台任务
  // ----------------------------------------------------------

  CREATE_TASK: `CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','done','failed','cancelled')),
  queue_order INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  started_at TEXT,
  finished_at TEXT
)`,

  CREATE_INDEX_TASK_STATUS: 'CREATE INDEX IF NOT EXISTS idx_task_status ON task(status)',
  CREATE_INDEX_TASK_ORDER: 'CREATE INDEX IF NOT EXISTS idx_task_queue_order ON task(queue_order)',

  INSERT_TASK: 'INSERT INTO task (type, queue_order, payload) VALUES (?, ?, ?)',
  SELECT_TASKS_ALL: 'SELECT * FROM task ORDER BY queue_order, id',
  SELECT_MAX_QUEUE_ORDER: 'SELECT COALESCE(MAX(queue_order), 0) AS maxQueueOrder FROM task',
  SELECT_TASK_BY_ID: 'SELECT * FROM task WHERE id = ?',
  UPDATE_TASK_RUNNING: "UPDATE task SET status = 'running', started_at = datetime('now','localtime'), message = ? WHERE id = ?",
  UPDATE_TASK_RESUME: "UPDATE task SET status = 'running' WHERE id = ?",
  UPDATE_TASK_PAUSED: "UPDATE task SET status = 'paused' WHERE id = ?",
  UPDATE_TASK_PROGRESS: 'UPDATE task SET progress = ?, message = ? WHERE id = ?',
  UPDATE_TASK_FINISHED: `UPDATE task SET status = ?, progress = ?, message = ?, result = ?, error = ?,
  finished_at = datetime('now','localtime') WHERE id = ?`,
  UPDATE_TASK_QUEUE_ORDER: 'UPDATE task SET queue_order = ? WHERE id = ?',
  DELETE_TASKS_FINISHED: "DELETE FROM task WHERE status IN ('done','failed','cancelled')",

  /** 准图库列表基语句，调用方按需追加 WHERE 与 ORDER BY */
  SELECT_PROCESSED_VIEW_BASE: `SELECT pi.*, c.name AS characterName, g.name AS galleryName,
    ps.name AS scriptName, pi.selected_file AS selectedFileName,
    f.thumbnail AS selectedFileThumbnail, f.width AS selectedFileWidth,
    f.height AS selectedFileHeight, f.file_size AS selectedFileSize
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  JOIN gallery g ON pi.gallery_id = g.id
  LEFT JOIN process_script ps ON pi.script_id = ps.id
  LEFT JOIN image_file f ON pi.selected_file = f.file_path
  WHERE 1 = 1`,
};

/** 全部建表语句，按外键依赖顺序排列 */
export const DDL_ALL: string[] = [
  SQL.CREATE_GALLERY,
  SQL.CREATE_CHARACTER,
  SQL.CREATE_IMAGE_GROUP,
  SQL.CREATE_IMAGE_FILE,
  SQL.CREATE_INDEX_IMAGE_FILE_GROUP,
  SQL.CREATE_PROCESS_SCRIPT,
  SQL.CREATE_SCRIPT_TYPE,
  SQL.CREATE_PROCESSED_IMAGE,
  SQL.CREATE_INDEX_PROCESSED_CHARACTER,
  SQL.CREATE_INDEX_PROCESSED_GALLERY,
];
