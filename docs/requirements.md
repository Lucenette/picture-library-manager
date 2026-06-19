# 二次元壁纸图库管理器 - 需求文档

> **状态：已确认，待开工**

## 项目概述

将多个卖家处购买的二次元壁纸汇总到统一图库，按角色分组，每个版本（电脑/平板/手机）选一张最合适的入库。

---

## 真实目录结构（依据示例图库）

### 图库一：三端壁纸（规范型）

```
三端壁纸（示例图库一）/
└── A-阿波尼亚/                    ← 角色目录
    ├── A-阿波尼亚-01/              ← 图片组（一层子目录）
    │   ├── 无损原图/               ← 子分类目录
    │   │   ├── A-阿波尼亚-01-平板.png
    │   │   ├── A-阿波尼亚-01-手机.png
    │   │   └── A-阿波尼亚-01-电脑.png
    │   └── 高清压缩/               ← 子分类目录
    │       ├── A-阿波尼亚-01-平板.jpg
    │       ├── A-阿波尼亚-01-手机.jpg
    │       └── A-阿波尼亚-01-电脑.jpg
    ├── A-阿波尼亚-02/ ～ 07/
    └── ...
└── S-神里绫人/
    └── S-神里绫人-01/
        ├── 无损原图/
        └── 高清压缩/
```

特点：角色下多个图片组，图片组内有子分类目录（无损原图/高清压缩），文件名包含设备标识。

### 图库二：动漫游戏人物（非规范型）

```
动漫游戏人物（示例图库二）/
└── A-阿尼亚/
    └── 01 阿尼亚 转存后再下载 防丢失/   ← 图片组（长名称，角色下只有一个）
        ├── 平板.jpeg
        ├── 手机.jpeg
        ├── 电脑.jpeg
        ├── 封面.png                       ← 非壁纸！需人工排除
        └── Thumbs.db                      ← 系统文件，扫描时跳过
└── S-神里绫人/
    └── 232 神里绫人 点转存再下载 防丢失/
        ├── 封面.png
        ├── 平板_upscayl_4x_realesrgan-x4plus.png
        ├── 手机.png
        └── 电脑_upscayl_4x_realesrgan-x4plus.png
└── Y-御坂美琴/
    └── 76 御坂美琴 转存后再下载 防丢失/
        ├── Thumbs.db
        ├── 封面.png
        ├── 平板_upscayl_4x_realesrgan-x4plus.png
        ├── 手机.png
        └── 电脑_upscayl_4x_realesrgan-x4plus.png
```

特点：角色下只有一个图片组（名称带店铺前缀），图片组内文件扁平无子目录，文件名不规则（含 `_upscayl_4x_realesrgan-x4plus` 等后缀），混有封面图和系统文件。

### 关键结论

- 角色目录 = 图库根目录下的第一层子目录
- 图片组 = 角色目录下的第一层子目录
- **虚拟组**：如果角色目录下有直接散放的图片文件（不属于任何子目录），自动归入一个名为 `(未分类)` 的虚拟图片组
- 扫描时按图片扩展名白名单过滤（见下文），`Thumbs.db` 等非图片文件不收录
- 图片组内的子目录结构差异巨大（有子分类 / 无子分类），必须通过自定义脚本处理

---

## 三大页面

### 页面一：图库管理

**功能：**
- 添加图库目录（Electron dialog 选择文件夹）
- 查看已添加的图库列表（名称、路径、扫描时间）
- 点击"扫描"按钮，后台扫描目录：
  - 识别角色列表（图库根目录 → 第一层子目录 = 角色）
  - 识别每个角色下的图片组（角色目录 → 第一层子目录 = 图片组；散放图片 → 虚拟组）
  - 递归收集每个图片组下的图片文件（按白名单过滤扩展名）
  - 读取图片元信息（分辨率、文件大小）
  - 结果写入 SQLite 数据库
- 显示扫描进度（角色数 / 图片组数 / 文件数）

**数据产生：**
- `gallery` 表：图库基本信息
- `character` 表：角色列表
- `image_group` 表：图片组列表（含虚拟组）
- `image_file` 表：每个图片组下的所有图片文件及元信息

---

### 页面二：处理确认

**功能概述：** 将扫描到的角色和图片组以列表展示，用户勾选后选择预定义脚本进行批处理，或手动标记为"已排除"。

**详细功能：**

1. **列表展示**
   - 树形展示：图库 → 角色 → 图片组
   - 每个图片组显示：目录名、文件数、处理状态标记
   - 三种状态：**未处理**（默认）/ **已处理** / **已排除**
   - 支持按状态过滤（全部 / 未处理 / 已处理 / 已排除）
   - 支持按图库过滤

2. **脚本管理**
   - 用户在本机编写 `.js` 脚本文件
   - UI 中点击"添加脚本" → 文件选择器选择 `.js` 文件 → 读取内容存入数据库
   - 支持"重载"：从源文件重新读取内容刷新数据库中的脚本
   - 脚本列表显示：名称、源文件路径、加载时间
   - **脚本接口规范：**
     ```javascript
     /**
      * @param {string} groupDirPath - 图片组目录的绝对路径
      * @returns {string} 选中的图片文件绝对路径
      * @throws {Error} 跳过该图片组（不选任何文件，保持未处理状态）
      */
     module.exports = function(groupDirPath) {
         const fs = require('fs');
         const path = require('path');
         // ... 自定义处理逻辑
         return selectedFilePath;
     };
     ```
   - **无安全沙箱**：脚本直接 `require()` 任意 Node 模块，拥有完整系统权限
   - 执行前 `delete require.cache[require.resolve(scriptPath)]` 确保每次获取最新代码

3. **批量处理**
   - 勾选角色（处理该角色下所有未处理/已处理的图片组）或勾选单个图片组
   - 选择一个预定义脚本
   - 执行批处理：
     - 逐图片组调用脚本
     - 脚本正常返回 → 标记为"已处理"，结果写入 `processed_image` 表
     - 脚本抛错 → 跳过该图片组，保持原状态，继续下一个
     - 显示处理进度（当前 N/M，错误计数）
   - 已处理的图片组可**重新处理**：换脚本再跑，覆盖旧结果
   - 已排除的图片组不参与处理

4. **排除标记**
   - 勾选图片组后可标记为"已排除"（广告图、封面图等不想要的）
   - 已排除的图片组可恢复为"未处理"
   - 已排除的图片组不出现在页面三

5. **手动确认**
   - 未处理的图片组可展开查看目录下的所有文件
   - 直接点选一个文件完成手动确认（等同于脚本处理，但不记录脚本 ID）

**数据产生：**
- `process_script` 表：脚本元信息
- `processed_image` 表：处理结果记录
- `image_group.status` 字段：标记排除状态

---

### 页面三：准图库

**功能概述：** 展示所有已处理确认的图片，支持过滤、删除和导出。

**详细功能：**

1. **列表展示**
   - 所有已处理图片的列表（来自 `processed_image` 表）
   - 每张图片显示：角色名、图库名、原始图片组路径、选中文件路径、确认时间、处理脚本名
   - 支持按图库、角色过滤
   - 支持图片预览（缩略图）

2. **删除管理**
   - 删除选中图片的 `processed_image` 记录
   - **不删除原始文件**
   - 删除后对应图片组在页面二中自动恢复为"未处理"状态
   - 支持批量勾选删除

3. **导出功能**
   - 点击"导出"按钮 → 弹出对话框选择目标目录
   - 确认后显示进度条，逐文件复制
   - 导出规则：
     - 目标目录结构：
       ```
       目标目录/
         ├── A-阿波尼亚/
         │     ├── A-阿波尼亚_0001.png
         │     ├── A-阿波尼亚_0002.png
         │     └── ...
         ├── S-神里绫人/
         │     ├── S-神里绫人_0001.png
         │     └── ...
         └── ...
       ```
     - 仅按角色分一级目录，不保留原始嵌套
     - 文件统一重命名：`{角色名}_{序号4位补零}.{原始扩展名}`
     - 序号按角色独立计数，从 0001 开始

---

## 数据模型

```sql
-- ============================================================
-- 图库：每一家卖家的图包对应一条记录
-- ============================================================
CREATE TABLE IF NOT EXISTS gallery (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增主键
    name        TEXT    NOT NULL,                     -- 图库名称（取根目录名）
    root_path   TEXT    NOT NULL UNIQUE,              -- 图库根目录绝对路径，唯一约束防重复添加
    scanned_at  TEXT,                                 -- 最近一次扫描时间 ISO8601
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- 角色：图库根目录下的第一层子目录
-- ============================================================
CREATE TABLE IF NOT EXISTS character (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    gallery_id  INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,                     -- 角色名（目录名，如 "A-阿波尼亚"）
    source_path TEXT    NOT NULL,                     -- 角色目录绝对路径
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(gallery_id, name)                         -- 同一图库下角色名不可重复
);

-- ============================================================
-- 图片组：角色目录下的第一层子目录（或虚拟组 "(未分类)"）
-- ============================================================
CREATE TABLE IF NOT EXISTS image_group (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id  INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
    dir_name      TEXT    NOT NULL,                   -- 目录名（图片组名称）
    dir_path      TEXT    NOT NULL UNIQUE,            -- 目录绝对路径，唯一约束
    file_count    INTEGER NOT NULL DEFAULT 0,         -- 该组下图片文件总数
    -- 状态：pending(未处理) | processed(已处理) | excluded(已排除)
    status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'excluded')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- 图片文件：图片组下递归收集的所有图片文件（扩展名白名单过滤后）
-- 支持在 img 标签中直接预览的格式：png, jpg, jpeg, gif, webp, bmp, svg, avif, ico
-- ============================================================
CREATE TABLE IF NOT EXISTS image_file (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_group_id  INTEGER NOT NULL REFERENCES image_group(id) ON DELETE CASCADE,
    file_name       TEXT    NOT NULL,                 -- 文件名（含扩展名）
    file_path       TEXT    NOT NULL UNIQUE,          -- 文件绝对路径
    file_size       INTEGER,                          -- 文件大小（字节）
    width           INTEGER,                          -- 图片宽度（像素），从文件头读取
    height          INTEGER,                          -- 图片高度（像素），从文件头读取
    extension       TEXT    NOT NULL,                 -- 扩展名（小写，如 "png"）
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 索引：按图片组查询文件
CREATE INDEX IF NOT EXISTS idx_image_file_group ON image_file(image_group_id);

-- ============================================================
-- 处理脚本：用户编写的 .js 文件，从磁盘加载后内容存入此表
-- ============================================================
CREATE TABLE IF NOT EXISTS process_script (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,                     -- 脚本名称（取文件名，如 "select-best.js"）
    file_path   TEXT    NOT NULL UNIQUE,              -- 脚本源文件绝对路径，用于重载和执行
    code        TEXT    NOT NULL,                     -- 脚本源代码内容（从文件读取）
    loaded_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),  -- 最近一次加载/重载时间
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- 已处理图片（准图库）：每个图片组经脚本处理或手动确认后产生一条记录
-- 一个图片组最多一条记录（UNIQUE(image_group_id)）
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_image (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_group_id  INTEGER NOT NULL UNIQUE REFERENCES image_group(id) ON DELETE CASCADE,
    character_id    INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
    gallery_id      INTEGER NOT NULL REFERENCES gallery(id) ON DELETE CASCADE,
    original_path   TEXT    NOT NULL,                 -- 原始图片组目录绝对路径（冗余，方便查询）
    selected_file   TEXT    NOT NULL,                 -- 最终选中的图片文件绝对路径
    script_id       INTEGER REFERENCES process_script(id) ON DELETE SET NULL,  -- 使用的脚本（手动确认为 NULL）
    confirmed_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 索引：按角色/图库过滤查询
CREATE INDEX IF NOT EXISTS idx_processed_character ON processed_image(character_id);
CREATE INDEX IF NOT EXISTS idx_processed_gallery   ON processed_image(gallery_id);
```

---

## 技术方案

| 组件 | 选型 | 说明 |
|---|---|---|
| 壳 | Electron | `nodeIntegration: true`, `contextIsolation: false`，无 preload |
| 前端 | Vue 3 + Vite + TypeScript | Composition API + `<script setup lang="ts">` |
| 数据库 | SQLite via `better-sqlite3` | 同步 API，渲染进程直接 `require()` |
| 脚本执行 | Node.js 原生 `require()` | 每次执行前清 cache，无沙箱 |
| 图片元信息 | `image-size` 库 | 读取宽高，不加载完整图片 |
| UI 组件 | Element Plus | 表格、树形控件、对话框、进度条 |
| 打包 | electron-builder | Windows 单包输出 |
| 代码规范 | TypeScript 严格模式 | 类型定义完整，JSDoc 全覆盖，分号必加 |

---

## 图片扩展名白名单

> 原则：能在 `<img>` 标签中直接预览的格式才收录

| 扩展名 | 收录 | 说明 |
|---|---|---|
| `.png` | ✅ | |
| `.jpg` `.jpeg` | ✅ | |
| `.gif` | ✅ | |
| `.webp` | ✅ | |
| `.bmp` | ✅ | |
| `.svg` | ✅ | |
| `.avif` | ✅ | Electron(Chromium) 支持 |
| `.ico` | ✅ | |
| `.tiff` `.tif` | ❌ | 浏览器 `<img>` 不支持 |
| `.psd` | ❌ | |
| `.ai` | ❌ | |
| `.heic` `.heif` | ❌ | 兼容性差 |
| `.db` 等非图片 | ❌ | 扫描时直接跳过 |

---

## 确认记录

- [x] 导出命名：`{角色名}_{0001}.{扩展名}`，序号按角色独立，4 位补零
- [x] 脚本格式：`.js` (CommonJS)，`module.exports = function(groupDirPath): string`
- [x] 脚本无沙箱，直接 `require()` 执行
- [x] 脚本从本机文件加载/重载，内容存入 DB
- [x] 已处理图片组可重新处理（覆盖旧结果）
- [x] 准图库支持删除记录（不删文件），删除后页面二自动恢复未处理
- [x] 扫描时记录图片分辨率（宽高）
- [x] 所有安全功能砍掉（nodeIntegration、contextIsolation 全开）
- [x] 图片组三种状态：未处理 / 已处理 / 已排除
- [x] 虚拟组：角色下散放图片归入 `(未分类)`
- [x] 图片扩展名白名单过滤
- [x] 数据库字段注释详尽，代码 JSDoc 完整，TS 严格模式

