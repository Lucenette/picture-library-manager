# 贡献指南

感谢你愿意为这个项目出力。开始之前，请先读完本文，以及仓库根目录的 [AGENTS.md](./AGENTS.md)——后者写清了这个项目的分层规则、代码规范与自检清单，**对人和对 AI 一视同仁**。

参与本项目即表示你同意遵守 [行为准则](./CODE_OF_CONDUCT.md)。

---

## 环境准备

| 要求 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 22.12** | 受 Electron 40 约束，低于该版本无法安装依赖 |
| Yarn | 1.x（经典版） | 也可用 npm，但本项目按 Yarn 1 的布局开发 |
| 操作系统 | Windows 10/11 | 目前只支持 Windows |

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
| `yarn build` | 打包 NSIS 安装程序到 `dist/` |

> `yarn typecheck` 依赖 `vue-tsc`，它是 devDependency，必须先 `yarn install`。

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
| `main` | 稳定版 |
| `develop` | 日常开发，PR 默认合到这里 |

---

## 自检清单

PR 之前至少跑通：

- [ ] `node_modules/.bin/tsc -p tsconfig.node.json` —— 覆盖主进程与 `src/common`
- [ ] 渲染进程的 `.ts` 类型检查（`.vue` 需 `vue-tsc`）
- [ ] `.vue` 能通过 `@vue/compiler-sfc` 的 parse + compileScript + compileTemplate
- [ ] 所有 `@/` 与 `@common/` 导入都能落到真实文件
- [ ] 手工冒烟受影响的界面：改了主进程/窗口/worker/IPC 的，**静态检查通过不等于功能正常**

AGENTS.md 的"改完必须自检"一节给了逐条做法。

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
