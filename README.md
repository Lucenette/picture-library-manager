<div align="center">

# 🖼 壁纸图库管理器

**多来源二次元壁纸汇总管理工具**

[![Electron](https://img.shields.io/badge/Electron-40.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Lucenette/picture-library-manager?style=social)](https://github.com/Lucenette/picture-library-manager)

</div>

---

## 📖 简介

面对来源各异的图库目录——有的按"角色→图片组→设备分类"，有的按"编号→角色→图片"，文件名千奇百怪——**壁纸图库管理器**让你自动扫描、批量整理、一键导出到统一目录。

核心流程：**添加图库 → 扫描识别 → 脚本选图 → 导出整理**。

扫描、选图、导出都是后台任务：跑在主进程，图片解码在工作线程，界面全程不卡；任务可暂停、继续、强制结束与重试。

### 🤖 AI 参与率

本项目由 AI 辅助开发，约 **95%** 代码及文档由 AI 生成。目前AI共消耗（输入、输出）约 **1,125,759,422 tokens**，产生的花费约为 **52.33 CNY**。

---

## ✨ 功能

### 图库管理
- 添加多个图包目录，支持多选批量添加
- 自定义目录结构识别脚本，适配任意目录规范
- 批量扫描（提交为后台任务）、清理数据、删除图库

### 任务管理
- 扫描、批量选图、导出统一走任务队列，同时只允许一个任务执行
- 排队中的任务可取消，也可上移/下移调整顺序
- 执行中的任务可暂停与继续；强制结束需二次确认
- 失败或已取消的任务可一键重试，已结束的任务可批量清理
- 进度、阶段描述与耗时实时展示，导航栏常驻运行中数量角标

### 角色确认
- 扫描后统一查看和校对所有角色名称
- 支持双击/按钮重命名单个角色，批量重命名
- 按图库、角色名、源路径模糊筛选

### 脚本系统
- JavaScript 脚本引擎，支持自定义选图/识别逻辑
- 自动检测导出函数类型（`select-image` / `identify-character` / `identify-structure`）
- 脚本代码安全存储于数据库，源文件丢失仍可执行
- 支持重命名、重载、批量管理

### 图片组确认
- 表格展示所有图片组，支持按图库/角色/路径/状态筛选与分页
- 批量选择脚本处理（基于文件元数据选图，不重复扫描）
- 标记排除/取消排除，已处理/未处理状态跟踪
- 查看图片组文件详情，缩略图预览

### 缩略图系统
- 扫描时自动生成 100×100 中心裁剪缩略图（WebP），**任何尺寸的图片都会生成**
- 解码与缩放运行在独立工作线程，扫描期间主进程保持响应
- 解码按内存预算分批调度：普通图并发，上亿像素的大图独占一批
- 解码与缩放统一用 [sharp](https://sharp.pixelplumbing.com/)（libvips）：按需缩放解码，内存与耗时降一个数量级
- 以 WebP 字节存于数据库，预览零开销
- 收录 PNG / JPEG / GIF / WebP / BMP / SVG / AVIF / ICO；每一张都会交给 sharp 尝试解码，生成缩略图与感知哈希，失败张数在任务结果里显示

### 图片查看器
- 独立窗口浏览原图，支持缩放拖拽
- 滚轮缩放（适应~5x），双击切换 1:1
- 底部缩略图导航条，当前图片居中高亮
- 键盘左右切换；开发态自动打开 DevTools，F12 切换

### 导出整理
- 按角色分组导出，文件统一重命名（`角色名_0001.png`）
- 支持勾选导出或全部导出，导出在后台任务中执行
- 原生文件夹选择器

### 暗色主题
- JetBrains IDE 风格暗色 UI
- Element Plus 组件全覆盖
- 自定义滚动条、下拉浮窗等原生体验

---

## 🛠 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Electron 40 | `nodeIntegration` + `contextIsolation: false`，渲染进程直接用 Node 能力 |
| 前端 | Vue 3 + Vite 6 + TypeScript 5 | Composition API + `<script setup>` |
| UI 组件 | Element Plus 2 | 暗色主题全覆盖 |
| 数据库 | SQLite (node:sqlite) | Electron 内置，真实文件 + WAL，单条写入毫秒级落盘 |
| 图片解码 | sharp (libvips) | 按需缩放解码 + 裁剪；原生依赖，各平台各自安装预编译包 |
| 并发 | Node worker_threads | 解码跑在工作线程，不阻塞主进程 |
| 任务调度 | 自研 TaskManager | 单并发队列，支持暂停/继续/强制结束/重试 |
| 构建工具 | electron-vite + electron-builder | 一键打包 NSIS 安装程序 |

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 22.12（Electron 40 的要求）
- Yarn（推荐）或 npm
- Windows 10/11

### 开发

```bash
git clone https://github.com/Lucenette/picture-library-manager.git
cd picture-library-manager
yarn install
yarn dev        # 启动开发环境
yarn typecheck  # 类型检查：主进程 tsc + 渲染进程 vue-tsc
```

### 解码引擎：sharp

缩略图解码只有一种实现——[sharp](https://sharp.pixelplumbing.com/)（libvips）。它按需对大图做
shrink-on-load（1/2、1/4、1/8），不把整图铺成 RGBA 位图：一张 15360×8640 的 JPEG 按整图解码要 500 MB 以上。

- 是**显式依赖**（`package.json`）：**没有内置解码器，也没有回落**，加载失败会直接报错，不会静默换成慢路径
- **跨平台**：官方提供 Windows / macOS / Linux（x64 与 arm64）预编译包，且是 N-API 模块，
  在 Electron 里不需要 electron-rebuild
- 顺带支持 EXIF 方向校正、WebP / AVIF / TIFF

### 打包

```bash
yarn build
```

输出 `dist/PLManager_Setup_1.0.0.exe`（NSIS 安装程序，`productName` 为 `PLManager`）。

---

## 📁 目录结构

```
picture-library-manager/
├── data/            # 示例处理脚本，打包时随附
├── docs/            # 设计说明、路线图、排障（入口见 docs/README.md）
├── scripts/         # 仓库自检脚本（文档与 skill）
├── src/
│   ├── common/      # 主进程与渲染进程共用的契约（类型、IPC 通道名）
│   ├── main/        # 主进程：窗口、数据库、任务、图片流水线、脚本
│   └── renderer/    # 渲染进程：Vue 3 界面，不引用任何 Node 内置模块
└── .agents/skills/  # 编码代理的工作流（文档规范）
```

---

## 📝 脚本系统

脚本以 CommonJS 源码字符串存储在数据库中，**在主进程执行**：录入时自动检测导出了哪些方法，执行时按需编译。因此源文件丢失也不影响已入库的脚本。

### 脚本格式

```javascript
// 导出具名函数，框架自动检测类型
module.exports = {
    "select-image": ({ characterName, groupDirPath, files }) => {
        return files[0].uuid;
    },
    "identify-character": (dirName) => {
        return String(dirName).trim();
    },
    "identify-structure": ({ rootPath, tree }) => {
        // 返回 [{ name, groups }]
    },
};
```

### 可用的脚本类型

| 类型 | 函数签名 | 用途 | 由谁调用 |
|---|---|---|---|
| `identify-structure` | `({rootPath, tree}) => [{name, groups}]` | 从目录树映射角色→图片组 | 扫描任务 |
| `select-image` | `(ctx) => uuid` | 从图片组文件列表中选一张 | 批量选图任务 |
| `identify-character` | `(dirName) => string` | 从目录名提取角色名称 | 结构脚本内部自行调用 |

> `identify-character` 目前不作为独立脚本被框架调用：它的逻辑通常由结构脚本在映射目录时自己调用（见 `data/default.js`）。

### 选图上下文

```typescript
ctx = {
    characterName: string,       // 角色名称
    groupDirPath: string,        // 图片组绝对路径
    files: Array<{               // 文件列表（已含元数据）
        uuid: string,            //   临时 UUID，返回此值即选中
        fileName: string,
        filePath: string,
        width: number | null,
        height: number | null,
        fileSize: number,
        ext: string,
    }>,
}
```

### 结构脚本的输入

```typescript
ctx = {
    rootPath: string,            // 图库根目录
    tree: DirNode[],             // 目录树；children 为 null 表示文件，[] 表示空目录
}
```

---

## 📚 文档

| 文档 | 内容 |
|---|---|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 环境准备、开发流程、提交与分支规范、自检清单 |
| [AGENTS.md](./AGENTS.md) | 分层规则、代码规范、运行时约定（人与 AI 共用） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 进程模型、任务系统、线程边界、数据流、关键取舍 |
| [docs/SCRIPTING.md](./docs/SCRIPTING.md) | 脚本接口参考、完整示例、错误语义与调试方式 |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | 按现象排查：卡顿、缩略图、数据库、构建、脚本 |
| [docs/requirements.md](./docs/requirements.md) | 最初的需求规格（历史文档，部分已被实现取代） |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更记录 |
| [SECURITY.md](./SECURITY.md) | 安全模型与漏洞报告方式 |

---

## 🤝 贡献

欢迎提 Issue 和 PR。

- 开工前请先读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)
- 缺陷请走 [Bug 反馈模板](.github/ISSUE_TEMPLATE/bug_report.yml)，安全问题见 [SECURITY.md](./SECURITY.md)

分支约定：`develop`；提交信息用中文，形如 `范围：做了什么`。

## 📄 许可证

MIT © Lucenette

---

<div align="center">

**[⬆ 回到顶部](#-壁纸图库管理器)**

</div>
