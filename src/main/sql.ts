// ============================================================
// SQL 常量 —— 所有 SQL 语句集中管理
// ============================================================

// ============================================================
// DDL
// ============================================================

export const CREATE_GALLERY = `CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`;

export const CREATE_CHARACTER = `CREATE TABLE IF NOT EXISTS character (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gallery_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(gallery_id, name)
)`;

export const CREATE_IMAGE_GROUP = `CREATE TABLE IF NOT EXISTS image_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  dir_name TEXT NOT NULL,
  dir_path TEXT NOT NULL UNIQUE,
  file_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','excluded')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`;

export const CREATE_IMAGE_FILE = `CREATE TABLE IF NOT EXISTS image_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_group_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  extension TEXT NOT NULL,
  thumbnail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`;

export const CREATE_PROCESS_SCRIPT = `CREATE TABLE IF NOT EXISTS process_script (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  loaded_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`;

export const CREATE_PROCESSED_IMAGE = `CREATE TABLE IF NOT EXISTS processed_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_group_id INTEGER NOT NULL UNIQUE,
  character_id INTEGER NOT NULL,
  gallery_id INTEGER NOT NULL,
  original_path TEXT NOT NULL,
  selected_file TEXT NOT NULL,
  script_id INTEGER,
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`;

export const CREATE_INDEX_IMAGE_FILE = 'CREATE INDEX IF NOT EXISTS idx_image_file_group ON image_file(image_group_id)';
export const CREATE_INDEX_PROCESSED_CHAR = 'CREATE INDEX IF NOT EXISTS idx_processed_character ON processed_image(character_id)';
export const CREATE_INDEX_PROCESSED_GALLERY = 'CREATE INDEX IF NOT EXISTS idx_processed_gallery ON processed_image(gallery_id)';

/** 所有建表语句（按依赖顺序） */
export const DDL_ALL = [
  CREATE_GALLERY,
  CREATE_CHARACTER,
  CREATE_IMAGE_GROUP,
  CREATE_IMAGE_FILE,
  CREATE_INDEX_IMAGE_FILE,
  CREATE_PROCESS_SCRIPT,
  CREATE_PROCESSED_IMAGE,
  CREATE_INDEX_PROCESSED_CHAR,
  CREATE_INDEX_PROCESSED_GALLERY,
];

// ============================================================
// Gallery
// ============================================================

export const SQL_INSERT_GALLERY = 'INSERT INTO gallery (name, root_path) VALUES (?, ?)';
export const SQL_SELECT_GALLERY_ALL = 'SELECT * FROM gallery ORDER BY created_at DESC';
export const SQL_SELECT_GALLERY_BY_ID = 'SELECT * FROM gallery WHERE id = ?';
export const SQL_DELETE_GALLERY = 'DELETE FROM gallery WHERE id = ?';

/** 级联删除：删图库时手动清理所有关联数据（按依赖逆序） */
export const SQL_DELETE_PROCESSED_BY_GALLERY = 'DELETE FROM processed_image WHERE gallery_id = ?';
export const SQL_DELETE_IMAGE_FILES_BY_GALLERY = `DELETE FROM image_file WHERE image_group_id IN (SELECT id FROM image_group WHERE character_id IN (SELECT id FROM character WHERE gallery_id = ?))`;
export const SQL_DELETE_IMAGE_GROUPS_BY_GALLERY = 'DELETE FROM image_group WHERE character_id IN (SELECT id FROM character WHERE gallery_id = ?)';
export const SQL_DELETE_CHARACTERS_BY_GALLERY = 'DELETE FROM character WHERE gallery_id = ?';
export const SQL_UPDATE_GALLERY_SCAN = "UPDATE gallery SET scanned_at = datetime('now','localtime') WHERE id = ?";

// ============================================================
// Character
// ============================================================

export const SQL_INSERT_CHARACTER = 'INSERT OR IGNORE INTO character (gallery_id, name, source_path) VALUES (?, ?, ?)';
export const SQL_SELECT_CHARACTER_BY_GALLERY_NAME = 'SELECT * FROM character WHERE gallery_id = ? AND name = ?';
export const SQL_SELECT_CHARACTERS_BY_GALLERY = 'SELECT * FROM character WHERE gallery_id = ? ORDER BY name';

// ============================================================
// ImageGroup
// ============================================================

export const SQL_INSERT_IMAGE_GROUP = 'INSERT OR IGNORE INTO image_group (character_id, dir_name, dir_path, file_count) VALUES (?, ?, ?, ?)';
export const SQL_SELECT_IMAGE_GROUP_BY_PATH = 'SELECT * FROM image_group WHERE dir_path = ?';
export const SQL_UPDATE_IMAGE_GROUP_FILE_COUNT = 'UPDATE image_group SET file_count = ? WHERE id = ?';
export const SQL_UPDATE_IMAGE_GROUP_STATUS = 'UPDATE image_group SET status = ? WHERE id = ?';
export const SQL_UPDATE_IMAGE_GROUP_PROCESSED = "UPDATE image_group SET status='processed' WHERE id = ?";
export const SQL_SELECT_IMAGE_FILES_BY_GROUP = 'SELECT * FROM image_file WHERE image_group_id = ? ORDER BY file_name';

/** ImageGroup 带关联查询的基 SQL（需动态拼接 WHERE/ORDER BY） */
export const SQL_SELECT_IMAGE_GROUPS_VIEW_BASE = `SELECT ig.*, c.name AS characterName, g.name AS galleryName, g.id AS galleryId
  FROM image_group ig
  JOIN character c ON ig.character_id = c.id
  JOIN gallery g ON c.gallery_id = g.id
  WHERE 1=1`;

// ============================================================
// ImageFile
// ============================================================

export const SQL_INSERT_IMAGE_FILE = 'INSERT OR IGNORE INTO image_file (image_group_id, file_name, file_path, file_size, width, height, extension, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';

// ============================================================
// ProcessScript
// ============================================================

export const SQL_SELECT_SCRIPT_BY_PATH = 'SELECT * FROM process_script WHERE file_path = ?';
export const SQL_SELECT_SCRIPT_BY_ID = 'SELECT * FROM process_script WHERE id = ?';
export const SQL_SELECT_SCRIPTS_ALL = 'SELECT * FROM process_script ORDER BY name';
export const SQL_DELETE_SCRIPT = 'DELETE FROM process_script WHERE id = ?';
export const SQL_INSERT_SCRIPT = "INSERT INTO process_script (name, file_path, code, brief, loaded_at) VALUES (?, ?, ?, ?, datetime('now','localtime'))";
export const SQL_UPDATE_SCRIPT = "UPDATE process_script SET name=?, code=?, brief=?, loaded_at=datetime('now','localtime') WHERE file_path=?";
export const SQL_RELOAD_SCRIPT = "UPDATE process_script SET code=?, brief=?, loaded_at=datetime('now','localtime') WHERE file_path=?";
export const SQL_RENAME_SCRIPT = 'UPDATE process_script SET name=? WHERE id=?';

// ============================================================
// ProcessedImage
// ============================================================

export const SQL_SELECT_PROCESSED_BY_GROUP = 'SELECT * FROM processed_image WHERE image_group_id = ?';
export const SQL_SELECT_PROCESSED_BY_ID_GROUP = 'SELECT image_group_id FROM processed_image WHERE id = ?';
export const SQL_DELETE_PROCESSED = 'DELETE FROM processed_image WHERE id = ?';
export const SQL_UPDATE_PROCESSED = "UPDATE processed_image SET selected_file=?, script_id=?, confirmed_at=datetime('now','localtime') WHERE image_group_id=?";
export const SQL_INSERT_PROCESSED = "INSERT INTO processed_image (image_group_id, character_id, gallery_id, original_path, selected_file, script_id, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))";
export const SQL_UPDATE_GROUP_PENDING = "UPDATE image_group SET status='pending' WHERE id = ?";

/** ProcessedImage 带关联查询的基 SQL */
export const SQL_SELECT_PROCESSED_VIEW_BASE = `SELECT pi.*, c.name AS characterName, g.name AS galleryName, ps.name AS scriptName, pi.selected_file AS selectedFileName, f.thumbnail AS selectedFileThumbnail, f.width AS selectedFileWidth, f.height AS selectedFileHeight, f.file_size AS selectedFileSize
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  JOIN gallery g ON pi.gallery_id = g.id
  LEFT JOIN process_script ps ON pi.script_id = ps.id
  LEFT JOIN image_file f ON pi.selected_file = f.file_path
  WHERE 1=1`;
