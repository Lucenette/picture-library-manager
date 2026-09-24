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
  // 相似图片识别结果
  //
  // 只保留最近一次识别：重跑时先清空三张表再写入，避免结果无限增长。
  // 成员只存路径与距离，缩略图等信息读的时候再 join image_file。
  // ----------------------------------------------------------

  CLEAR_SIMILAR_MEMBERS: 'DELETE FROM similar_member',
  CLEAR_SIMILAR_GROUPS: 'DELETE FROM similar_group',
  CLEAR_SIMILAR_RUNS: 'DELETE FROM similar_run',
  INSERT_SIMILAR_RUN: 'INSERT INTO similar_run (compared, skipped) VALUES (?, ?)',
  INSERT_SIMILAR_GROUP: 'INSERT INTO similar_group (run_id, kind, size) VALUES (?, ?, ?)',
  INSERT_SIMILAR_MEMBER: 'INSERT INTO similar_member (group_id, file_path, distance) VALUES (?, ?, ?)',
  SELECT_SIMILAR_RUN_LATEST: 'SELECT compared, skipped FROM similar_run ORDER BY id DESC LIMIT 1',
  SELECT_SIMILAR_GROUPS: `SELECT g.id AS group_id, g.kind AS kind, m.file_path AS file_path, m.distance AS distance,
  f.file_name AS file_name, f.thumbnail AS thumbnail, f.width AS width, f.height AS height
  FROM similar_group g
  JOIN similar_member m ON m.group_id = g.id
  LEFT JOIN image_file f ON f.file_path = m.file_path
  ORDER BY g.id, m.distance`,
  SELECT_SIMILAR_INPUT: `SELECT f.file_path AS file_path, f.file_name AS file_name, f.thumbnail AS thumbnail,
  f.width AS width, f.height AS height, f.phash AS phash
  FROM processed_image pi
  JOIN image_file f ON f.file_path = pi.selected_file`,

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