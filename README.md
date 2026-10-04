<div align="center">

# 角色图库管理器

**把来源各异的角色图片，整理成按角色分组、可直接用于训练的数据集**

[![CI](https://github.com/Lucenette/picture-library-manager/actions/workflows/verify.yml/badge.svg)](https://github.com/Lucenette/picture-library-manager/actions/workflows/verify.yml)
[![Electron](https://img.shields.io/badge/Electron-44.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Lucenette/picture-library-manager?style=social)](https://github.com/Lucenette/picture-library-manager)

</div>

---

**角色图库管理器**是一个本地优先的桌面应用：把从各处收集来、目录规范五花八门的角色图片，扫描成「角色 → 图片组」的结构，用脚本按你的规则批量选图，最后按角色导出成统一命名的数据集。

- **本地优先**：图片、数据库、脚本全在本机；没有账号、没有云端。
- **界面不卡**：扫描、选图、导出都是后台任务，图片解码在工作线程；任务可暂停、继续、强制结束与重试。
- **脚本即规则**：目录结构识别与选图逻辑用 JavaScript 脚本表达，不把任何一种目录规范写死。
- **取消不丢**：扫描逐张写入数据库，取消或崩溃都不会丢掉已完成的部分。

> English overview: [README.en.md](./README.en.md) —— 中文文档为准。

## 目录

- [截图](#截图)
- [功能](#功能)
- [工作流程](#工作流程)
- [快速开始](#快速开始)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [脚本系统](#脚本系统)
- [文档](#文档)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可证](#许可证)

## 截图

> 🚧 截图待补。五张界面截图（任务管理、图组平铺视图、脚本管理、图片查看器、暗色图库）的清单与拍摄要求见 [docs/images/README.md](./docs/images/README.md)；图片就位后会替换这一节。

## 功能

### 来源与扫描
- 登记多个图包目录作为来源，支持多选批量添加
- 自定义目录结构识别脚本，适配任意目录规范
- 批量扫描（提交为后台任务）、清理数据、删除来源

### 任务队列
- 扫描、批量选图、导出统一走任务队列，同时只允许一个任务执行
- 排队中的任务可取消，也可上移 / 下移调整顺序
- 执行中的任务可暂停与继续；强制结束需二次确认
- 失败或已取消的任务可一键重试，已结束的任务可批量清理
- 进度、阶段描述与耗时实时展示，导航栏常驻运行中数量角标

### 角色与图片组
- 扫描后统一查看和校对所有角色名称，支持单个 / 批量重命名
- 按图库、角色名、源路径模糊筛选
- 表格展示所有图片组，支持按图库 / 角色 / 路径 / 状态筛选与分页
- 批量选择脚本处理（基于文件元数据选图，不重复扫描）
- 标记排除 / 取消排除，已处理 / 未处理状态跟踪
- 查看图片组文件详情与缩略图预览
- 列表 / 平铺两种视图：平铺是相册式两级展开，一次只展开一个分组

### 图库与导出
- 浏览与筛选每个图片组最终确认下来的那张图
- 删除记录（不删原始文件，对应图片组自动退回未处理）
- 标记为可选并识别相似图片
- 按角色分组导出，统一重命名（`角色名_0001.png`）；勾选导出或全部导出，导出在后台任务中执行

### 脚本
- JavaScript 脚本引擎，支持自定义选图 / 识别逻辑
- 自动检测导出函数类型（`select-image` / `identify-character` / `identify-structure`）
- 脚本正文是用户目录 `scripts/` 下的一份 `.js` 文件，库里只留索引；那份文件就是唯一副本
- 支持分组：新建 / 重命名 / 删除分组，把脚本拖进分组；分组只影响脚本管理页
- 常驻编辑器，每个脚本保留独立的编辑状态；重命名、放弃修改、删除、恢复默认走原生右键菜单

### 缩略图与图片查看器
- 扫描时自动生成 100×100 中心裁剪缩略图（WebP），任何尺寸的图片都会生成
- 解码与缩放运行在独立工作线程；按内存预算分批，上亿像素的大图独占一批
- 解码统一用 sharp（libvips），缩略图字节存于数据库，预览零开销
- 收录 PNG / JPEG / GIF / WebP / BMP / SVG / AVIF / ICO
- 独立窗口浏览原图：滚轮缩放（适应 ~5x）、双击 1:1、底部缩略图导航、键盘左右切换

### 界面
- 自绘标题栏 + 左侧导航栏，失焦时整条 chrome 同步压暗
- 确认、输入、文件查看、批量处理、扫描配置等一律原生弹窗，不用页面内弹窗
- JetBrains 风格暗色主题，Element Plus 组件全覆盖

## 工作流程

```text
添加来源  →  扫描识别  →  脚本选图  →  导出整理
```

1. **添加来源**：在来源管理里登记一个或多个图包目录。
2. **扫描识别**：结构脚本把目录树映射成「角色 → 图片组」，并生成缩略图与感知哈希。
3. **脚本选图**：对每个图片组运行选图脚本（也可手动确认），结果进入图库。
4. **导出整理**：按角色复制到目标目录，统一重命名。
5. **（可选）相似识别**：对图库中已选定的图片做哈希比对，找出重复与相似。

扫描、选图、导出都在后台任务里跑，可暂停、可重试，界面全程可交互。

## 快速开始

### 环境要求

| 要求 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 22.12** | 受 Electron 44 约束，低于该版本无法安装依赖 |
| Yarn | 1.x（经典版） | 也可用 npm，但本项目按 Yarn 1 的布局开发 |
| 操作系统 | Windows / macOS / Linux | 三平台都能出安装包；日常开发与验证在 Windows 上进行 |

### 开发

```bash
git clone https://github.com/Lucenette/picture-library-manager.git
cd picture-library-manager
yarn install
yarn dev        # 启动开发环境
yarn preview    # 构建后预览生产产物（不打包）
yarn typecheck  # 类型检查：主进程 tsc + 渲染进程 vue-tsc

yarn lint       # ESLint：规范、.vue 模板编译、导入解析与类型感知规则
yarn test       # 单元测试：主进程与渲染进程两份 vitest 配置
```

> Electron 42 起官方不再在 install 阶段下载二进制（改成首次运行 `electron .` 时按需拉取）。本项目在 `postinstall` 里显式把它装好，所以 `yarn install` 之后可以直接 `yarn dev`；GitHub 拉不动时用环境变量 `ELECTRON_MIRROR` 指定镜像。

### 打包

```bash
yarn build          # 当前平台：Windows 出 NSIS，macOS 出 dmg，Linux 出 AppImage / deb
yarn build:win      # 指定平台（交叉构建不行，CI 里按平台各跑各的）
yarn build:mac
yarn build:linux
```

输出 `dist/PLManager_Setup_<版本>.exe`（NSIS 安装程序，`productName` 为 `PLManager`）。

### 解码引擎

缩略图解码只有一种实现——[sharp](https://sharp.pixelplumbing.com/)（libvips）。它按需对大图做
shrink-on-load（1/2、1/4、1/8），不把整图铺成 RGBA 位图。sharp 是**显式依赖，没有内置解码器、也没有回落**：
加载失败会直接报错，不会静默换成慢路径。跨平台预编译包由官方提供，且是 N-API 模块，在 Electron 里不需要 electron-rebuild。

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Electron 44 | `nodeIntegration` + `contextIsolation: false`，渲染进程直接用 Node 能力 |
| 前端 | Vue 3 + Vite 6 + TypeScript 5 | Composition API + `<script setup>` |
| UI 组件 | Element Plus 2 | 暗色主题全覆盖 |
| 数据库 | SQLite（`node:sqlite`） | Electron 内置，真实文件 + WAL，单条写入毫秒级落盘 |
| 图片解码 | sharp（libvips） | 按需缩放解码 + 裁剪；原生依赖，各平台各自安装预编译包 |
| 并发 | Node `worker_threads` | 解码跑在工作线程，不阻塞主进程 |
| 任务调度 | 自研 TaskManager | 单并发队列，支持暂停 / 继续 / 强制结束 / 重试 |
| 静态检查 | ESLint 10 + typescript-eslint + eslint-plugin-vue | 类型感知规则；`.vue` 模板编译与导入解析一并覆盖 |
| 构建工具 | electron-vite + electron-builder | 一键打包三平台安装程序 |

## 目录结构

```text
picture-library-manager/
├── docs/            # 设计说明、路线图、排障（入口见 docs/README.md）
│   └── images/      # README 引用的界面截图
├── scripts/         # 仓库脚本（文档检查、样例图库、发布说明）
├── test/            # 单元测试：主进程与渲染进程两棵树（见 docs/design/test-system.md）
├── src/
│   ├── common/      # 主进程与渲染进程共用的契约（类型、IPC 通道名）
│   ├── main/        # 主进程：窗口、数据库、任务、图片流水线、脚本
│   ├── renderer/    # 渲染进程：Vue 3 界面，每类窗口一个入口（见 entries/）
│   └── static/      # 构建资源：应用图标、内置默认脚本源码
└── .agents/skills/  # 编码代理的工作流（文档、提交信息、数据库、发布）
```

## 脚本系统

脚本是一份 CommonJS 的 `.js` 文件，正文放在**用户目录的 `scripts/` 下**（打包态 `~/.plmanager/scripts/`，开发态 `dist/scripts/`），库里只留索引：名称、文件路径、内置标记、类型关联与所属分组。「加载文件」只是把选中的文件**复制**一份进 `scripts/`，原文件此后不再被读写——所以复制出来的那一份就是脚本唯一的副本，删掉就没了。

脚本**在主进程执行**：打开或保存时检测导出了哪些方法，每次调用前重新读盘并编译。因此用外部编辑器改完文件，下一次扫描 / 选图就会用新内容，不需要在应用里点任何按钮。

新库自带一份**内置默认脚本**（名为「默认」），装完即可直接扫描；它不能删除，右键的「恢复默认」会用随应用发布的源码覆盖回出厂版本（文件被删也能借此重建）。

### 脚本格式

```javascript
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
| `identify-structure` | `({rootPath, tree}) => [{name, groups}]` | 从目录树映射「角色 → 图片组」 | 扫描任务 |
| `select-image` | `(ctx) => uuid` | 从图片组文件列表中选一张 | 批量选图任务 |
| `identify-character` | `(dirName) => string` | 从目录名提取角色名称 | 结构脚本内部自行调用 |

完整的接口、上下文与示例见 [docs/SCRIPTING.md](./docs/SCRIPTING.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 环境准备、开发流程、提交与分支规范、自检清单 |
| [AGENTS.md](./AGENTS.md) | 分层规则、代码规范、运行时约定（人与 AI 共用） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 进程模型、任务系统、线程边界、数据流、关键取舍 |
| [docs/SCRIPTING.md](./docs/SCRIPTING.md) | 脚本接口参考、完整示例、错误语义与调试方式 |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | 按现象排查：卡顿、缩略图、数据库、构建、脚本 |
| [docs/design/](./docs/design/) | 已落地子系统的设计说明：为什么这样、有哪些不变量 |
| [docs/roadmap/](./docs/roadmap/) | 尚未实施的方案与进行中的事项 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更记录 |
| [SECURITY.md](./SECURITY.md) | 安全模型与漏洞报告方式 |

## 路线图

计划中的事项与进度见 [docs/roadmap/README.md](./docs/roadmap/README.md)。其中几项较大的：

- 任务独立进程与全任务断点续跑
- 设置页面（统一的配置落点）
- 颜色主题切换（深色 / 浅色 / 跟随系统）
- 相似图片管理，以及用 CLIP 语义向量加强相似识别
- 构建目标扩展到 Windows / Linux arm64

## 贡献

欢迎提 Issue 和 PR。

- 开工前请先读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)
- 想找活干：Issues 里标了 [`good first issue`](https://github.com/Lucenette/picture-library-manager/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 的条目
- 提问与想法走 [GitHub Discussions](https://github.com/Lucenette/picture-library-manager/discussions)
- 缺陷请走 [Bug 反馈模板](.github/ISSUE_TEMPLATE/bug_report.yml)，安全问题见 [SECURITY.md](./SECURITY.md)

分支约定：`develop`；提交信息用中文，形如 `范围：做了什么`。

## 许可证

MIT © Lucenette

---

<div align="center">

**[⬆ 回到顶部](#角色图库管理器)**

</div>
