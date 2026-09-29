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
  // Source
  // ----------------------------------------------------------

  INSERT_SOURCE: 'INSERT INTO source (name, name_sort, root_path, root_path_sort) VALUES (?, ?, ?, ?)',
  SELECT_SOURCE_ALL: 'SELECT * FROM source ORDER BY created_at DESC',
  SELECT_SOURCE_BY_ID: 'SELECT * FROM source WHERE id = ?',
  DELETE_SOURCE: 'DELETE FROM source WHERE id = ?',
  UPDATE_SOURCE_SCAN: "UPDATE source SET scanned_at = datetime('now','localtime') WHERE id = ?",

  // 删除来源时按依赖逆序手工级联清理
  DELETE_PROCESSED_BY_SOURCE: 'DELETE FROM processed_image WHERE source_id = ?',
  DELETE_IMAGE_FILES_BY_SOURCE: `DELETE FROM image_file WHERE image_group_id IN (
  SELECT id FROM image_group WHERE character_id IN (SELECT id FROM character WHERE source_id = ?)
)`,
  DELETE_IMAGE_GROUPS_BY_SOURCE: `DELETE FROM image_group WHERE character_id IN (
  SELECT id FROM character WHERE source_id = ?
)`,
  DELETE_CHARACTERS_BY_SOURCE: 'DELETE FROM character WHERE source_id = ?',

  // ----------------------------------------------------------
  // Character
  // ----------------------------------------------------------

  INSERT_CHARACTER: 'INSERT OR IGNORE INTO character (source_id, name, name_sort, source_path) VALUES (?, ?, ?, ?)',
  SELECT_CHARACTER_BY_SOURCE_NAME: 'SELECT * FROM character WHERE source_id = ? AND name = ?',
  SELECT_CHARACTERS_BY_SOURCE: 'SELECT * FROM character WHERE source_id = ? ORDER BY name',
  RENAME_CHARACTER: 'UPDATE character SET name = ?, name_sort = ? WHERE id = ?',

  // ----------------------------------------------------------
  // ImageGroup
  // ----------------------------------------------------------

  INSERT_IMAGE_GROUP: 'INSERT OR IGNORE INTO image_group (character_id, dir_name, dir_name_sort, dir_path, dir_path_sort, file_count) VALUES (?, ?, ?, ?, ?, ?)',
  SELECT_IMAGE_GROUP_BY_PATH: 'SELECT * FROM image_group WHERE dir_path = ?',
  UPDATE_IMAGE_GROUP_STATUS: 'UPDATE image_group SET status = ? WHERE id = ?',
  UPDATE_IMAGE_GROUP_PROCESSED: "UPDATE image_group SET status = 'processed' WHERE id = ?",
  UPDATE_IMAGE_GROUP_PENDING: "UPDATE image_group SET status = 'pending' WHERE id = ?",

  /** 图片组列表基语句，调用方按需追加 WHERE 与 ORDER BY */
  SELECT_IMAGE_GROUPS_VIEW_BASE: `SELECT ig.*, c.name AS characterName, g.name AS sourceName, g.id AS sourceId
  FROM image_group ig
  JOIN character c ON ig.character_id = c.id
  JOIN source g ON c.source_id = g.id
  WHERE 1 = 1`,

  // ----------------------------------------------------------
  // ImageFile
  // ----------------------------------------------------------

  INSERT_IMAGE_FILE: 'INSERT OR IGNORE INTO image_file (image_group_id, file_name, file_name_sort, file_path, file_size, width, height, extension, thumbnail, phash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  SELECT_IMAGE_FILES_BY_GROUP: 'SELECT * FROM image_file WHERE image_group_id = ? ORDER BY file_name',
  SELECT_GROUP_ID_BY_FILE_PATH: 'SELECT image_group_id FROM image_file WHERE file_path = ?',

  // ----------------------------------------------------------
  // ScriptGroup
  // ----------------------------------------------------------

  /** 建分组：名字允许重复，靠 id 区分 */
  INSERT_SCRIPT_GROUP: 'INSERT INTO script_group (name) VALUES (?)',
  /** 顺序交给界面（中文要按拼音，SQL 给不了），这里只保证顺序稳定 */
  SELECT_SCRIPT_GROUPS: 'SELECT * FROM script_group ORDER BY id',
  SELECT_SCRIPT_GROUP_BY_ID: 'SELECT id FROM script_group WHERE id = ?',
  RENAME_SCRIPT_GROUP: 'UPDATE script_group SET name = ? WHERE id = ?',
  SET_SCRIPT_GROUP_COLLAPSED: 'UPDATE script_group SET collapsed = ? WHERE id = ?',
  DELETE_SCRIPT_GROUP: 'DELETE FROM script_group WHERE id = ?',
  /** 删分组时把成员放回「未分组」 */
  CLEAR_SCRIPT_GROUP_MEMBERS: 'UPDATE process_script SET group_id = NULL WHERE group_id = ?',

  // ----------------------------------------------------------
  // ProcessScript
  // ----------------------------------------------------------

  INSERT_SCRIPT: "INSERT INTO process_script (name, file_path, builtin, group_id, loaded_at) VALUES (?, ?, ?, ?, datetime('now','localtime'))",
  SELECT_SCRIPT_BY_PATH: 'SELECT * FROM process_script WHERE file_path = ?',
  SELECT_SCRIPT_BY_ID: 'SELECT * FROM process_script WHERE id = ?',
  SELECT_SCRIPT_BUILTIN: 'SELECT * FROM process_script WHERE builtin = 1 LIMIT 1',
  SELECT_SCRIPTS_ALL: 'SELECT * FROM process_script ORDER BY name',
  /** 改名：正文在文件里，这里只动名称与时间戳；图库那份名字副本由调用方在同一个事务里跟着改 */
  RENAME_SCRIPT: "UPDATE process_script SET name = ?, loaded_at = datetime('now','localtime') WHERE id = ?",
  /** 脚本行的排序键：单独一条 UPDATE——老库升级途中还没有这一列，见 db.ts 的说明 */
  SET_SCRIPT_SORT: 'UPDATE process_script SET name_sort = ? WHERE id = ?',
  /** 接管旧脚本与内置脚本落盘：只回填文件路径 */
  SET_SCRIPT_FILE_PATH: "UPDATE process_script SET file_path = ?, loaded_at = datetime('now','localtime') WHERE id = ?",
  TOUCH_SCRIPT_LOADED_AT: "UPDATE process_script SET loaded_at = datetime('now','localtime') WHERE id = ?",
  /** 改归属：`null` 就是放回「未分组」 */
  SET_SCRIPT_GROUP: 'UPDATE process_script SET group_id = ? WHERE id = ?',
  /** 改写图库里的脚本名副本（改名级联） */
  RENAME_PROCESSED_SCRIPT_NAME: 'UPDATE processed_image SET script_name = ? WHERE script_id = ?',
  /** 图库里脚本名副本的排序键，同上 */
  SET_PROCESSED_SCRIPT_SORT: 'UPDATE processed_image SET script_name_sort = ? WHERE script_id = ?',
  COUNT_PROCESSED_BY_SCRIPT: 'SELECT COUNT(*) AS processed FROM processed_image WHERE script_id = ?',
  /** 老库接管用：库里还有 code 列时，把每一条的源码读出来 */
  SELECT_LEGACY_SCRIPTS: 'SELECT id, name, file_path, code FROM process_script',
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

  /** 图库行里存一份「当时是哪个脚本选的」名字副本：脚本删掉之后仍然显示得出来 */
  INSERT_PROCESSED: "INSERT INTO processed_image (image_group_id, character_id, source_id, original_path, selected_file, script_id, script_name, script_name_sort, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))",
  SELECT_PROCESSED_BY_GROUP: 'SELECT * FROM processed_image WHERE image_group_id = ?',
  SELECT_PROCESSED_BY_ID_GROUP: 'SELECT image_group_id FROM processed_image WHERE id = ?',
  UPDATE_PROCESSED: "UPDATE processed_image SET selected_file = ?, script_id = ?, script_name = ?, script_name_sort = ?, confirmed_at = datetime('now','localtime') WHERE image_group_id = ?",
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

  /** 图库列表基语句，调用方按需追加 WHERE 与 ORDER BY */
  SELECT_PROCESSED_VIEW_BASE: `SELECT pi.*, c.name AS characterName, g.name AS sourceName,
    pi.script_name AS scriptName, pi.selected_file AS selectedFileName,
    f.thumbnail AS selectedFileThumbnail, f.width AS selectedFileWidth,
    f.height AS selectedFileHeight, f.file_size AS selectedFileSize
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  JOIN source g ON pi.source_id = g.id
  LEFT JOIN image_file f ON pi.selected_file = f.file_path
  WHERE 1 = 1`,

  /** 图库行总数：与 `SELECT_PROCESSED_VIEW_BASE` 同一套 join 与谓词，页码才和分片对得上 */
  COUNT_PROCESSED_VIEW_BASE: `SELECT COUNT(*) AS total
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  JOIN source g ON pi.source_id = g.id
  LEFT JOIN image_file f ON pi.selected_file = f.file_path
  WHERE 1 = 1`,

  /** 图库轻量索引行：平铺的三态与「全选本分组」靠它，不带缩略图 */
  SELECT_PROCESSED_INDEX_BASE: `SELECT pi.id AS id, c.name AS characterName
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  WHERE 1 = 1`,

  /**
   * 图库平铺一级：角色 + 当前筛选下的图片数；调用方追加 WHERE / GROUP BY / LIMIT。
   *
   * 按 `c.name` 归组（不是 `c.id`）：同一个角色可能出现在多个来源里，那是同一张卡。
   * `characterId` 取该名字下最小的 id，只当卡片的稳定句柄用。
   */
  SELECT_PROCESSED_CHARACTER_TILES_BASE: `SELECT MIN(c.id) AS characterId, c.name AS characterName, COUNT(*) AS count
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  WHERE 1 = 1`,

  /** 图库平铺一级的总数：当前筛选下有图可显示的角色名数 */
  COUNT_PROCESSED_CHARACTERS_BASE: `SELECT COUNT(DISTINCT c.name) AS total
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  WHERE 1 = 1`,

  /** 角色封面：每个角色一张缩略图，取文件名排序最靠前的那张；`%IDS%` 由调用方换成占位符 */
  SELECT_CHARACTER_COVERS: `SELECT id, thumbnail FROM (
    SELECT pi.character_id AS id, f.thumbnail AS thumbnail,
      ROW_NUMBER() OVER (PARTITION BY pi.character_id ORDER BY f.file_name_sort, f.id) AS rn
    FROM processed_image pi
    JOIN image_file f ON f.file_path = pi.selected_file
    WHERE pi.character_id IN (%IDS%)
  ) WHERE rn = 1`,

  /** 图组页一级总数：与 `SELECT_IMAGE_GROUPS_VIEW_BASE` 同一套 join */
  COUNT_IMAGE_GROUPS_VIEW_BASE: `SELECT COUNT(*) AS total
  FROM image_group ig
  JOIN character c ON ig.character_id = c.id
  JOIN source g ON c.source_id = g.id
  WHERE 1 = 1`,

  /** 图组页二级：图组内图片文件的一页，按文件名 */
  SELECT_IMAGE_FILES_PAGE: `SELECT * FROM image_file WHERE image_group_id = ?
  ORDER BY file_name_sort, id LIMIT ? OFFSET ?`,

  /** 图组内图片总数 */
  COUNT_IMAGE_FILES: 'SELECT COUNT(*) AS total FROM image_file WHERE image_group_id = ?',

  /** 图组内排在锚点之前的图片数，顺序与二级分页一致（文件名 + id） */
  COUNT_IMAGE_FILES_BEFORE: `SELECT COUNT(*) AS total FROM image_file WHERE image_group_id = ?
  AND (file_name_sort, id) < (SELECT file_name_sort, id FROM image_file WHERE id = ?)`,

  /**
   * 图库分片用的「排序键视图」：把四个排序键都选出来。
   *
   * 查看器要按起始 id 算出它在整个序列里的下标，就得让排序键是这一层的普通列，
   * 才能用 `(键, id)` 的行值比较一次算出来。
   */
  SELECT_PROCESSED_SORT_VIEW_BASE: `SELECT pi.id AS id, c.name_sort AS characterSort,
    f.file_name_sort AS fileNameSort, pi.script_name_sort AS scriptNameSort, pi.confirmed_at AS confirmedAt
  FROM processed_image pi
  JOIN character c ON pi.character_id = c.id
  JOIN source g ON pi.source_id = g.id
  LEFT JOIN image_file f ON pi.selected_file = f.file_path
  WHERE 1 = 1`,

  /** 图组封面：每个图组一张缩略图，取文件名排序最靠前的那张；`%IDS%` 由调用方换成占位符 */
  SELECT_GROUP_COVERS: `SELECT id, thumbnail FROM (
    SELECT ig.id AS id, f.thumbnail AS thumbnail,
      ROW_NUMBER() OVER (PARTITION BY ig.id ORDER BY f.file_name_sort, f.id) AS rn
    FROM image_group ig
    JOIN image_file f ON f.image_group_id = ig.id
    WHERE ig.id IN (%IDS%)
  ) WHERE rn = 1`,

  // ----------------------------------------------------------
  // 升级账本
  //
  // 账本表由升级引擎用代码创建（不写进 changelog），这里只有读写语句。
  // 「跑过没有」按 (author, id, filename) 三元组判断，失败行不算跑过。
  // ----------------------------------------------------------

  SELECT_MIGRATION_LEDGER: 'SELECT author, id, filename, exectype, order_executed FROM schema_migration',
  WRITE_MIGRATION_LEDGER: `INSERT INTO schema_migration (author, id, filename, title, exectype, order_executed, applied_at, execution_ms)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)
  ON CONFLICT(author, id, filename) DO UPDATE SET
    title = excluded.title,
    exectype = excluded.exectype,
    order_executed = excluded.order_executed,
    applied_at = excluded.applied_at,
    execution_ms = excluded.execution_ms`,
};