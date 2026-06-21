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

### 🤖 AI 参与率

本项目由 AI 辅助开发，约 **95%** 代码及文档由 AI 生成。

<progress value="95" max="100" style="width:100%;height:10px;border-radius:10px;accent-color:#3871e1"></progress>

---

## ✨ 功能

### 图库管理
- 添加多个图包目录，支持多选批量添加
- 自定义目录结构识别脚本，适配任意目录规范
- 批量扫描、清理数据、删除图库

### 角色确认
- 扫描后统一查看和校对所有角色名称
- 支持双击/按钮重命名单个角色，批量重命名
- 按图库、角色名、源路径模糊筛选

### 脚本系统
- JavaScript 脚本引擎，支持自定义选图/识别逻辑
- 自动检测导出函数类型（`select-image` / `identify-character` / `identify-structure`）
- 脚本代码安全存储于数据库，文件丢失仍可执行
- 支持重命名、重载、批量管理

### 图片组确认
- 树形展示所有图片组，支持按图库/角色/路径/状态筛选
- 批量选择脚本处理（基于文件元数据选图，不重复扫描）
- 标记排除/取消排除，已处理/未处理状态跟踪
- 查看图片组文件详情，缩略图预览

### 缩略图系统
- 扫描时自动生成 50×50 中心裁剪缩略图
- Base64 存储于数据库，预览零开销
- 支持 JPEG / PNG / GIF / BMP / TIFF 全格式

### 图片查看器
- 独立窗口浏览原图，支持缩放拖拽
- 滚轮缩放（适应~5x），双击切换 1:1
- 底部缩略图导航条，当前图片居中高亮
- 键盘左右切换，F12 开发工具

### 导出整理
- 按角色分组导出，文件统一重命名（`角色名_0001.png`）
- 支持勾选导出或全部导出
- 原生文件夹选择器

### 暗色主题
- JetBrains IDE 风格暗色 UI
- Element Plus 组件全覆盖
- 自定义滚动条、下拉浮窗等原生体验

---

## 🛠 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Electron 40 | `nodeIntegration` + `contextIsolation: false` |
| 前端 | Vue 3 + Vite 6 + TypeScript 5 | Composition API + `<script setup>` |
| UI 组件 | Element Plus 2 | 暗色主题全覆盖 |
| 数据库 | SQLite (sql.js) | WASM 实现，零原生依赖，绿色便携 |
| 图片解码 | jpeg-js / pngjs / omggif / bmp-ts / utif2 | 全格式原生解码器 |
| 图像处理 | Jimp | 缩略图裁剪缩放 |
| 构建工具 | electron-vite + electron-builder | 一键打包 NSIS 安装程序 |

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- Yarn（推荐）或 npm
- Windows 10/11

### 开发

```bash
git clone https://github.com/Lucenette/picture-library-manager.git
cd picture-library-manager
yarn install
yarn dev
```

### 打包

```bash
yarn build
```

输出 `dist/壁纸图库管理器_Setup_1.0.0.exe`（NSIS 安装程序）。

---

## 📁 目录结构

```
picture-library-manager/
├── data/                        # 示例脚本，打包时随附
│   └── default.js               #   默认脚本（选图 + 角色识别 + 结构识别）
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             #   入口：初始化 DB、注册 IPC、创建窗口
│   │   ├── db.ts                #   数据库层（SQLite CRUD + IPC 调度）
│   │   ├── sql.ts               #   SQL 常量
│   │   ├── window-manager.ts    #   窗口管理器（创建/获取/关闭）
│   │   └── dialogs/             #   IPC 模块
│   │       ├── index.ts         #     统一注册入口
│   │       ├── system.ts        #     系统对话框/DevTools
│   │       ├── viewer.ts        #     图片查看器
│   │       ├── scan-config.ts   #     扫描配置
│   │       ├── batch-process.ts #     批量处理
│   │       ├── prompt.ts        #     通用输入弹窗
│   │       ├── file-viewer.ts   #     文件查看器
│   │       └── control/         #     原生控件
│   │           └── dropdown.ts  #        下拉列表浮窗
│   ├── renderer/                # Vue 渲染进程
│   │   ├── main.ts              #   入口：路由 + Element Plus
│   │   ├── App.vue              #   根组件：导航栏
│   │   ├── db/database.ts       #   数据库 IPC 包装层
│   │   ├── scanner/scanner.ts   #   目录扫描器 + 缩略图生成
│   │   ├── services/            #   业务服务
│   │   │   └── script-runner.ts #     脚本执行器
│   │   ├── components/          #   可复用组件
│   │   │   ├── CategorySearch.vue   #  分类筛选器
│   │   │   └── DropdownControl.vue  #  下拉选择控件
│   │   ├── views/               #   页面
│   │   │   ├── main/            #     主窗口页面
│   │   │   │   ├── GalleryPage.vue    图库管理
│   │   │   │   ├── CharacterPage.vue  角色确认
│   │   │   │   ├── ProcessPage.vue    图组确认
│   │   │   │   ├── LibraryPage.vue    图库导出
│   │   │   │   └── ScriptPage.vue     脚本管理
│   │   │   ├── image/           #     图片查看器
│   │   │   │   └── ImageViewer.vue
│   │   │   └── dialogs/         #     原生对话框
│   │   │       ├── ScanConfigDialog.vue
│   │   │       ├── BatchProcessDialog.vue
│   │   │       ├── PromptDialog.vue
│   │   │       ├── FileViewerDialog.vue
│   │   │       └── control/Dropdown.vue
│   │   └── styles/theme.css     #   暗色主题
│   └── common/                  # 共享
│       ├── types.ts             #   类型定义
│       └── ipcChannels.ts       #   IPC 通道常量
├── electron-builder.yml         # 打包配置
├── electron.vite.config.ts      # Vite 配置
└── package.json
```

---

## 📝 脚本系统

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

| 类型 | 函数签名 | 用途 |
|---|---|---|
| `select-image` | `(ctx) => uuid` | 从图片组文件列表中选一张 |
| `identify-character` | `(dirName) => string` | 从目录名提取角色名称 |
| `identify-structure` | `({rootPath, tree}) => [...]` | 从目录树映射角色→图片组 |

### select-image 上下文

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

---

## 🤝 贡献

欢迎提 Issue 和 PR。

## 📄 许可证

MIT © Lucenette

---

<div align="center">

**[⬆ 回到顶部](#-壁纸图库管理器)**

</div>
