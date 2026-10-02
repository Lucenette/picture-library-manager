# 贡献指南

> **English summary**: This project is maintained in Chinese. Issues, pull requests and discussions in English are welcome; the maintainer will translate. See [README.en.md](./README.en.md) for an English overview.

感谢你愿意为这个项目出力。开始之前，请先读完本文，以及仓库根目录的 [AGENTS.md](./AGENTS.md)——后者写清了这个项目的分层规则、代码规范与自检清单，**对人和对 AI 一视同仁**。

参与本项目即表示你同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。

本项目以**中文**协作：Issue、PR 与讨论用中文即可；提交信息也用中文，外部 PR 的英文提交信息由维护者统一改写。

---

## 环境准备

| 要求 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 22.12** | 受 Electron 44 约束，低于该版本无法安装依赖 |
| Yarn | 1.x（经典版） | 也可用 npm，但本项目按 Yarn 1 的布局开发 |
| 操作系统 | Windows / macOS / Linux | 三平台都能出安装包；日常开发与验证在 Windows 上进行 |

```bash
git clone https://github.com/Lucenette/picture-library-manager.git
cd picture-library-manager
yarn install
yarn dev
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `yarn dev` | 启动开发环境。主进程与 preload 由 electron-vite 构建，渲染进程走 Vite |
| `yarn typecheck` | 类型检查：主进程 `tsc` + 渲染进程 `vue-tsc` |
| `yarn build` | 打包当前平台（Windows NSIS / macOS dmg / Linux AppImage、deb）到 `dist/` |
| `node scripts/check-docs.mjs` | 文档检查：编码、相对链接与锚点、README 索引、skill frontmatter、占位符（零依赖） |
| `node scripts/make-fixture.mjs` | 生成样例图库到 `dist/fixture/`（零依赖，可重复执行） |
| `node scripts/check-code.mjs` | 代码规范检查：命名空间导入、控制语句大括号、渲染进程 Node 边界、database 反向依赖（需先 `yarn install`） |

> `yarn typecheck` 依赖 `vue-tsc`，它是 devDependency，必须先 `yarn install`。

---

## 样例图库

仓库不跟踪任何图片，但改扫描 / 选图 / 导出的人需要一份可扫描的输入。生成它（零依赖，可重复执行）：

```bash
node scripts/make-fixture.mjs
```

产物在 `dist/fixture/`（已被 `.gitignore` 忽略）。把下面三个目录**分别**作为来源添加，而不是把 `dist/fixture` 整个加进去：

| 来源目录 | 覆盖的目录规范 | 内置「默认」脚本识别结果（已实跑确认） |
|---|---|---|
| `dist/fixture/三端壁纸` | 角色 / 图片组 / 设备分类（三层） | 阿波尼亚（2 个图片组）、神里绫人（1 个） |
| `dist/fixture/动漫游戏人物` | 长名称图片组、编号开头的角色、角色下直接放图 | 雷电将军、阿尼亚、散图角色（各 1 个） |
| `dist/fixture/边界情况` | 必须被处理、但不该让流程崩掉的输入 | 测试角色（1 个） |

「边界情况」里特意放了非图片文件、0 字节文件、扩展名是图片但内容损坏的文件、超宽与超高比图片。它们**不应让扫描失败**：

- `说明.txt`、`Thumbs.db` 不是图片，扫描时直接跳过，不计入图片组的文件数；
- `损坏.png`、`空文件.png` 是图片扩展名但读不出内容：缩略图生成失败，计入任务结果里的失败张数，**不中断**整轮扫描。

真实大图不进样例库（会让生成与仓库都变重）。要验证解码分批或内存预算时，临时用 `sharp` 造一张再删掉即可：

```bash
node -e "require('sharp')({create:{width:8000,height:8000,channels:3,background:'#346'}}).png().toFile('dist/fixture/大图.png')"
```

改动扫描 / 选图 / 导出后，请用这份样例图库手工走一遍「添加来源 → 扫描 → 选图 → 导出」。

---

## 开发流程

1. Fork 仓库，从 `develop` 切出特性分支，例如 `feat/task-queue-priority`。
2. 改代码。**动手前先看 AGENTS.md 的"动手前的边界"**：涉及新增、移动、改名文件或目录，先在 Issue 里说清方案再动手。
3. 自检（见下节），确认全绿。
4. 提交，向 `develop` 发 PR。

### 提交信息

用中文，格式为 `范围：做了什么`：

```
后台任务：扫描/选图/导出迁移到主进程，缩略图解码走工作线程
文档：README 按实际行为校正，新增 AGENTS.md
修复：窗口 Web 安全开关在开发态被写反导致大图不显示
```

**范围**用一两字概括模块（后台任务 / 文档 / 修复 / 重构 / 性能 / 依赖 …），**做了什么**一句话说清。改动较大时在正文里分条列出要点与前提。

### 分支

| 分支 | 用途 |
|---|---|
| `master` | 稳定版 |
| `develop` | 日常开发，PR 默认合到这里 |

---

## 自检清单

PR 之前跑 [AGENTS.md](./AGENTS.md) 的「改完必须自检」清单，这里不另抄一份，避免两处漂移。

与贡献者最相关的三条：

- `node scripts/check-docs.mjs` —— 任何文档改动都要跑（零依赖，秒级）
- `node scripts/check-code.mjs` —— 改了 `.ts` / `.vue` 时（需先 `yarn install`）
- `yarn typecheck` —— 改了主进程或渲染进程时

静态检查通过不等于功能正常：改了主进程 / 窗口 / worker / IPC 的，请人工冒烟受影响的界面。

---

## 不知道从哪开始

下面五项都在 GitHub 上标了 `good first issue`，改动小、边界清楚，适合先熟悉流程。

**认领入口**：[标了 `good first issue` 的 Issues](https://github.com/Lucenette/picture-library-manager/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)。方案背景在 `docs/roadmap/` 的同名文件里。

| 起步项 | 大致动什么 | 背景 |
|---|---|---|
| 颜色主题切换 | 渲染进程 CSS 变量 | [theme.md](./docs/roadmap/theme.md) |
| 设置页面 | 主进程 + 渲染进程 | [settings-page.md](./docs/roadmap/settings-page.md) |
| 构建目标：32 位与 arm | 只动构建配置 | [build-targets.md](./docs/roadmap/build-targets.md) |
| 诊断：打开日志目录与收集日志 | 主进程 + 一个入口 | [diagnostics.md](./docs/roadmap/diagnostics.md) |
| 其余窗口的自绘标题栏 | 有现成设计可照抄 | [window-chrome.md](./docs/roadmap/window-chrome.md) |

---

## 协作方式

- **提问出口**：用法问题与想法走 [GitHub Discussions](https://github.com/Lucenette/picture-library-manager/discussions) 的 Q&A / Ideas；先查 [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)，查不到再问。
- **响应节奏**：Issue 与 PR 的首次回应通常在 3 个工作日内；合入 `develop` 后由维护者安排发布。
- **发布流程**：版本由维护者按 `.agents/skills/gitflow-release/SKILL.md` 的 gitflow 流程发布（`develop` → `release/<x.y>` → 合入 `master` → 打 tag → CI 出三平台产物）。贡献者只需在 `CHANGELOG.md` 的 `[未发布]` 段补条目，不需要关心版本号与发布段。
- **`.agents/skills/`**：那是给编码代理（AI）用的可复用工作流，人类贡献者可以选读；常驻的硬性约定看 [AGENTS.md](./AGENTS.md)。

---

## 代码规范

完整规范见 [AGENTS.md](./AGENTS.md)，最容易踩的三条：

1. **禁止 `import *` / `export *`**，一律具名导入。
2. **所有控制语句必须带大括号**，哪怕只有一行；`} else {` 写在同一行。
3. **渲染进程不得引用任何 Node 内置模块**（`fs`/`path`/`crypto`/图像解码库）。需要文件或重计算，放主进程。

此外：

- 注释与 JSDoc 用**中文**，解释意图与约束，不复述代码。
- 不留死代码：零引用的导出、没有 import 者的文件、只有一处实现的接口，都要清掉。
- 重型工作要么分片让出事件循环，要么交给工作线程——**不要长时间霸占主进程主线程**，否则窗口会卡住拖不动。

## 分层规则（速查）

| 目录 | 放什么 |
|---|---|
| `src/common/` | 主进程与渲染进程**都在用**的契约 |
| `src/main/image/` | 图片处理流水线（遍历 + 解码线程池） |
| `src/main/task/` | 后台任务编排（队列、状态机、runner） |
| `src/main/dialogs/` | 自己创建窗口的模块 |
| `src/renderer/` | 界面、状态、IPC 包装 |

判断口径：**按职责归类，不按"谁在用我"归类。**

---

## 文档维护

新增或修改功能时，请同步：

- `README.md` 的**功能**列表（用户能看到什么）
- `docs/ARCHITECTURE.md`（结构或数据流变了）
- `docs/SCRIPTING.md`（脚本接口变了）
- `CHANGELOG.md` 的 `[未发布]` 段

文档与代码不一致一律按 Bug 处理。

---

## 报告问题

- 缺陷请用 [Bug 反馈模板](.github/ISSUE_TEMPLATE/bug_report.yml)
- 功能建议请用 [功能请求模板](.github/ISSUE_TEMPLATE/feature_request.yml)
- 安全问题**不要开公开 Issue**，见 [SECURITY.md](./SECURITY.md)
