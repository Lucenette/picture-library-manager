# 二次元壁纸图库管理器

多来源二次元壁纸汇总管理工具，按角色分组，批量筛选入库。

## 功能

- **图库管理**：添加多个图包目录，批量扫描识别角色和图片结构
- **脚本处理**：编写 JS 脚本自定义选择规则，批量处理图片组
- **缩略图系统**：扫描时自动生成缩略图，预览零开销
- **图片查看器**：独立窗口浏览原图，支持缩放拖拽、左右切换
- **准图库导出**：按角色重命名导出，一键整理

## 技术栈

| 层 | 技术 |
|---|---|
| 壳 | Electron |
| 前端 | Vue 3 + Vite + TypeScript |
| UI | Element Plus（暗色主题） |
| 数据库 | SQLite (sql.js) |
| 图片处理 | jimp / jpeg-js / pngjs |

## 开发

```bash
yarn install
yarn dev
```

## 打包

```bash
yarn build
npx electron-builder
```

## 目录结构

```
├── data/              # 示例脚本，打包时随附
├── src/
│   ├── main/          # Electron 主进程（数据库、IPC、窗口管理）
│   ├── renderer/      # Vue 渲染进程（页面、扫描器、脚本执行）
│   └── common/        # 共享类型定义
├── electron.vite.config.ts
└── package.json
```

## License

MIT
