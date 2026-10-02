# 开源就绪

**状态**：进行中
**关联**：[test-system.md](./test-system.md)（检查脚本与运行器归它，本条目只规定检查哪些规则、跑在 CI 的哪一步）
**进展**：P0–P3 的仓库内改动全部完成并分次提交（`1bb58bb` / `bf7438c` / `fab2cc9` / `1cb2173` / `e33521a` / `19c7064` / `c0be05f` / `93b2dc7`）；剩余为使用者侧：五张截图、GitHub 仓库设置（Discussions / 标签 / 起步项 Issue）。全部确认后删除本文档，并清掉 `check-docs.mjs` 里的临时豁免。

---

## 1. 背景

1. **现状坐标：工程过程资产高、可参与性为零**。107 个源文件、11231 行代码（`src/` 占 10577 行，其中主进程 4145、渲染进程 5935），注释率 20%，`docs/` 5174 行——文档与代码之比约 0.46，同规模项目通常不到 0.2。缺的全在「别人能不能参与」这一层：测试文件 0 个、lint 配置 0 个、131 次提交全出自一位作者（bus factor 1）。
2. **对外承诺与事实是错的，而现有自检抓不到**：`CODE_OF_CONDUCT.md` 的「执行」一节把举报邮箱写作 `**<待填写>**`，`SECURITY.md` 的漏洞备用通道写作 `<维护者邮箱，待填写>`，而 `scripts/check-docs.mjs` 的占位符检查只匹配法文引号一对字符（`U+00AB` / `U+00BB`，见该文件的 `PLACEHOLDERS` 常量）——登记本条目之前运行它，输出是「文档检查通过：33 个文件，173 条链接」，两个尖括号占位符都不报。同一类问题还有一串：`CONTRIBUTING.md` 的分支表把稳定分支写作 `main`（实际是 `master`，见 `.github/workflows/verify.yml` 的 trigger），平台范围在「只支持 Windows」「Windows 10/11」与三平台产物之间有三种说法，`README.md` 徽章写 `Electron-40.x` 而正文写 Electron 44、打包示例写 `PLManager_Setup_1.0.0.exe` 而 `package.json` 是 1.1.1，`SECURITY.md` 的支持范围停在 `1.0.x`，`.github/dependabot.yml` 的 `image` 分组仍列着 `jimp` / `jpeg-js` / `pngjs` / `omggif` / `bmp-ts` / `utif2` 而运行依赖里的图片解码只剩 `image-size` 与 `sharp`。
3. **clone 下来没有任何可以扫描的图库**：这是一个遍历目录、按脚本识别结构再导出的工具，但仓库里没有样例图库，`docs/` 里也没写怎么造一份最小可复现的目录。贡献者改完扫描 / 选图 / 导出之后，没有任何输入可以验证。
4. **硬性规范没有自动检查，构建也不可复现**：禁止 `import *` / `export *`、控制语句必须带大括号、渲染进程不得引用 Node 内置模块、`src/main/database/` 不得反向依赖 `@/ups`——四条规范只写在 `AGENTS.md` 里，仓库里 `eslint.config.js` / `.eslintrc.json` / `.prettierrc` 一个都不存在。`.gitignore` 忽略了 `/yarn.lock`，两个工作流都只能跑 `yarn install --network-timeout 600000`；Node 版本（≥ 22.12）只写在 `CONTRIBUTING.md` 里，没有 `.nvmrc`、没有 `.node-version`、`package.json` 里也没有 `engines`。`verify.yml` 还是单个 `windows-latest` 作业（`timeout-minutes: 25`），零依赖的文档检查排在安装与构建之后才报。
5. **门面与入口都空着**：`README.md` 的 6 处图片引用全部是 shields.io 徽章、没有一张界面截图，也没有指向 `verify.yml` 的 CI 状态徽章，而全仓库与界面只有中文；仓库没有 `CODEOWNERS`、没有标签约定与响应预期；`docs/roadmap/README.md` 的「事项」表只有「主题 / 状态 / 文件」三列，没有难度与涉及层，`CONTRIBUTING.md` 也没有「从哪开始」；`.github/ISSUE_TEMPLATE/config.yml` 的 `blank_issues_enabled: false` 且只提供排障 / 安全 / 脚本三个链接，一个用法问题只能挤进 Bug 模板。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-29 | 首次定稿 | — |
| 2026-09-29 | 由「对外一致性 / 贡献者上手 / 质量闸门 / 门面治理」四份草稿合并为本条目，并补回实施顺序（P0–P3）与「明确不做」清单 | 评审：一份即可；分级与取舍要留在文档里，不能只留在对话里 |
| 2026-09-29 | 补入 §2 现状判断（三处摩擦、分维度评估、规模坐标、条件对照） | 评审：要留下「为什么做」的依据，不能只留在对话里 |

---

## 2. 现状判断

这一节回答「为什么做」。结论先行：**拦住外部贡献者的不是文档不足，而是三处摩擦——跑不起来、改不对、不敢发。** 这个项目的现状是「一个人的作品」而不是「别人敢改的项目」，差别不在代码质量，在可参与性。

### 2.1 三处摩擦

| 摩擦 | 现场 | 后果 |
|---|---|---|
| **跑不起来** | clone 后没有可扫描的图库，`docs/` 也没写怎么造（§1 第 3 条） | 贡献者改完扫描 / 选图 / 导出无法自证，只能盲改 |
| **改不对** | 四条硬性规范只在 `AGENTS.md` 里，lint 配置 0 个，渲染进程边界与 `database → ups` 反向依赖都靠人工 review（§1 第 4 条） | 不确定自己的 PR 会不会因不成文的规则被拒——外部贡献者流失的第二大原因 |
| **不敢发** | 测试文件 0 个；`.gitignore` 忽略 `yarn.lock`，CI 只能非冻结安装（§1 第 4 条） | 维护者不敢合（没有回归网），贡献者不敢改（改坏了看不出来） |

### 2.2 分维度评估

评价列的星数只用来排序，依据全部是本次实测：

| 维度 | 评价 | 依据 |
|---|---|---|
| 代码规模 | ★★★☆☆ | 107 个源文件 / 11231 行代码 |
| 模块划分 | ★★★★★ | 平均 148 行/文件；38 个文件 ≤50 行；最大 `ScriptPage.vue` 874 行 |
| 文档 | ★★★★★ | 5174 行；文档与代码之比约 0.46（同规模项目通常不到 0.2） |
| 注释 | ★★★★☆ | `src/` 注释率 20%，且是解释「为什么」的中文 JSDoc |
| 测试 | ☆☆☆☆☆ | 测试文件 0 个，无测试运行器 |
| Lint / 格式 | ★★☆☆☆ | `eslint.config.js` / `.eslintrc.json` / `.prettierrc` 均不存在 |
| CI | ★★★★☆ | 有 `verify.yml`（类型 + 三目标构建）与 `release.yml`（tag 守卫 + 三平台矩阵）；但没有 lint、没有测试，且是单个 25 分钟作业 |
| 开源门面 | ★★★★☆ | LICENSE / CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / CHANGELOG + 4 个 Issue/PR 模板 + dependabot 齐全；但没有截图、没有 CI 徽章、只有中文 |
| 依赖健康 | ★★★☆☆ | 9 个运行时 + 10 个开发依赖，全主流；但锁文件不入库，构建不可复现 |
| Bus factor | ★☆☆☆☆ | 131 次提交全出自一位作者 |

### 2.3 规模坐标

| 档位 | 大致规模 | 本仓库位置 |
|---|---|---|
| 玩具 / 单文件脚本 | <1k | |
| 小工具 | 1k–10k | |
| 中型独立应用 | 10k–50k | **← 11231 行代码在这里** |
| 大型应用 | 50k–200k | |
| 平台级（VS Code 级） | >200k | |

**判断**：代码量落在中型独立应用的下沿，文档密度、流程完整度与运行时工程细节落在该档位的上沿。放到开源平台上，它会因 README 与文档拿到第一批关注，也会因没有测试和截图停在那里——本条目补的就是后半段。

### 2.4 与「能吸引外部贡献者」的条件对照

| 条件 | 现状 | 本条目对应 |
|---|---|---|
| 有理由存在、能被发现 | 文档与 README 已很完整；缺截图与英文入口 | §4.6 |
| 一条命令就能跑起来 | 缺样例图库 | §4.2、§4.5 |
| 有明确、小块的入口 | 路线图无可认领度，无起步项 | §4.5 |
| 规则不必靠猜 | 四条硬性规范无自动检查 | §4.3 |
| 改动不会悄悄弄坏东西 | 0 测试、CI 无 lint | §4.3、§4.4（测试本体在 [test-system.md](./test-system.md)） |
| 回应可预期、归属清楚 | 无 `CODEOWNERS`、无响应预期、无提问出口 | §4.5、§4.7 |

---

## 3. 目标与非目标

**目标**

1. 对外文件里不再有指向不存在通道的占位符，同类占位符由检查拦住。
2. 分支名、平台支持范围、版本号、依赖分组在文档与配置之间各处一致。
3. 贡献者 clone 后能用一条命令造出一份可扫描的样例图库，并靠它走通「添加来源 → 扫描 → 选图 → 导出」。
4. `AGENTS.md` 的四条硬性规范由脚本检查、违规在 CI 失败；依赖安装可复现（锁文件入库 + 冻结安装 + 版本固定）。
5. 第一屏能看到产品界面与 CI 状态，并且有起步项、提问出口、目录归属与处理节奏可循。

**非目标**

- 不改产品行为、不改运行时；
- 不新建测试框架、不选测试运行器——那归 [test-system.md](./test-system.md)；
- 界面国际化与全量英文文档不在范围，英文只做到入口级（§4.6）。

**明确不做**

都是「为了看起来像开源」而加、实际只增加维护面的事：

| 不做 | 原因 |
|---|---|
| 引入 ESLint / Prettier 重排或改写现有代码 | 见 §4.3 的设计结论；Prettier 会重排全部代码，把真实改动埋掉 |
| 加 `.devcontainer/` | Electron GUI 在容器里跑不起来；Windows 贡献者需要的是版本固定（§4.3） |
| 设覆盖率门槛、做端到端测试 | [test-system.md](./test-system.md) 已定为非目标 |
| 加 `FUNDING.yml` 一类没有内容的社区文件 | 空壳比没有更减分——与两个空邮箱是同一类错 |
| 给路线图条目编号（`RM-01` 一类） | 用文件名引用即可 |
| 配分支保护强制 review | 单人维护下只会拖慢自己（§4.7） |

## 4. 设计

### 4.1 对外一致性与占位符检查

- **联系方式**：`CODE_OF_CONDUCT.md` 与 `SECURITY.md` 的两处邮箱都改成只走 GitHub 私密通道，不填个人邮箱——省掉一个要长期维护的信息，也不暴露联系方式。
- **占位符检查**：`scripts/check-docs.mjs` 的占位符规则在现有的法文引号（`U+00AB` / `U+00BB`）之外，再扩到尖括号形态（`<待填写>`、`<维护者…>`、`<TODO` 一类），只匹配这几个词根，不匹配任意尖括号；文件头第 5 条检查项说明同步改写。
- **一致性修正**：分支表 `main` → `master`；`CONTRIBUTING.md` 的自检清单补 `node scripts/check-docs.mjs`，并改成引用 `AGENTS.md`「改完必须自检」的 7 条而不是另抄一份；`README.md` 徽章与打包示例的版本号、`SECURITY.md` 的支持范围、`.github/dependabot.yml` 的 `image` 分组一并订正。
- **平台支持范围**按 §9 第 1 条的结论统一，四处（两份文档 + 打包配置 + CI）一起改。

### 4.2 样例图库

- **一条命令**：`node scripts/make-fixture.mjs`，零依赖，与 `scripts/check-docs.mjs` 同一路数；生成到 `dist/fixture/`（`dist/` 已被 `.gitignore` 忽略，不进版本库），可重复执行、每次覆盖。
- **覆盖仓库文档里出现过的目录规范**，好让内置默认脚本有活干：角色 → 图片组 → 设备分类；编号 → 角色 → 图片；图片直接放在根目录下（没有中间分组）。
- **同时放入必须被处理、但不应让流程崩掉的输入**：非图片文件、0 字节文件、扩展名是图片但内容损坏的文件、超宽或超高比图片。它们在任务结果里的表现（失败张数、是否计入图组）要写进 `CONTRIBUTING.md`。
- **图片本体用脚本生成**，总量控制在百 KB 级；真实大图不进样例库，需要大图的场景（解码分批、内存预算）单独说明怎么临时造。
- 每个目录会被识别成什么，**写之前先跑一遍确认**，不凭默认脚本的代码推测。

### 4.3 规范自动化与依赖可复现

**设计结论：不引入 ESLint，用零依赖的 AST 脚本检查这四条。** 仓库现有的三个自检脚本（`scripts/check-docs.mjs`、`scripts/release-notes.mjs`、`.agents/skills/db-maintenance/scripts/verify-migration.mjs`）都是零依赖，而 `typescript` 与 `@vue/compiler-sfc` 已是现有依赖（前者是 devDependency，后者由 `vue` 直接依赖），写 AST 遍历不需要新增任何包。**代价是没有编辑器内的实时提示与自动修复，检查只在命令行与 CI 里跑，规则要自己维护**；规则数量或格式化需求超出这个脚本的承受范围时再评估 ESLint（§9 第 2 条）。

| 规范（出处） | 检查方式 |
|---|---|
| 禁止 `import * as` / `export *`（硬性规范 1） | AST：`ImportDeclaration` 的 `ImportNamespaceSpecifier`、`ExportAllDeclaration` |
| 控制语句必须带大括号（硬性规范 2） | AST：`IfStatement` / `ForStatement` / `ForInStatement` / `ForOfStatement` / `WhileStatement` / `DoStatement` 的语句体必须是 `Block` |
| 渲染进程不得引用 Node 内置模块（运行时约定 1） | 解析 `src/renderer/**` 的 import 说明符并比对 Node 内置模块表；按 `AGENTS.md` 的既有例外放行 `electron` |
| `src/main/database/` 不得依赖 `@/ups`（分层规则、运行时约定 8） | 解析 `src/main/database/**` 的 import 说明符，出现 `@/ups` 即报错 |

- 前两条与 [test-system.md](./test-system.md) 目标 2 的「大括号」「导入解析」是同一件事，**以那一条的脚本为唯一实现**，本条目只补它没覆盖的两条；脚本名以那份文件落地时定的为准，不要各建一个。
- 检查同时覆盖 `.ts` 与 `.vue`：用 `@vue/compiler-sfc` 的 `parse` 取出 `script` / `scriptSetup` 两块 content 后走同一套 AST 遍历。
- **锁文件入库**：删掉 `.gitignore` 里的 `/yarn.lock`，把 `yarn.lock` 提交，CI 改 `yarn install --frozen-lockfile`。这会推翻 `AGENTS.md`「已知环境限制」里现有的一句（「`yarn.lock` 被 `.gitignore` 忽略，CI 无法使用冻结锁文件」），**两处必须同时改**。
- **工具链版本**：新增 `.nvmrc` 写当前开发用的 Node 版本；`package.json` 补 `engines.node`（≥ 22.12）——后者按 `AGENTS.md` 由使用者执行。

### 4.4 CI 作业结构

```
docs     ubuntu-latest    node scripts/check-docs.mjs          （零依赖，不装依赖）
check    ubuntu-latest    node scripts/check-code.mjs          （零依赖，装依赖前跑）
test     ...              待 test-system.md 落地后加
verify   windows-latest   yarn install --frozen-lockfile && yarn typecheck && npx electron-vite build
```

- `docs` 与 `check` 不需要安装依赖，能在几十秒内给出反馈，各自独立成作业、可单独重跑，不写成 `verify` 里的前置步骤。
- 三目标构建保持在 Windows 上跑（三平台矩阵只在 `release.yml` 里跑）；`release.yml` 的安装同样改 `--frozen-lockfile`。

### 4.5 贡献者入口

- **路线图加可认领度**：`docs/roadmap/README.md` 的「事项」表在「主题 / 状态 / 文件」之外加两列——**难度**（低 / 中 / 高）与**涉及**（仅渲染进程 / 主进程 + IPC / 需要动数据库 / 构建配置），需要先讨论方案的条目在「涉及」里写明「需先评审」。
- **起步项**：`CONTRIBUTING.md` 加一节「不知道从哪开始」，直接列出起步项并链到对应的 **Issue**（不是链到方案文档）：颜色主题切换（[theme.md](./theme.md)，纯渲染进程改 CSS 变量）、设置页面（[settings-page.md](./settings-page.md)）、构建目标 32 位与 arm（[build-targets.md](./build-targets.md)，只动构建配置）、诊断：打开日志目录（[diagnostics.md](./diagnostics.md)）、其余窗口的自绘标题栏（[window-chrome.md](./window-chrome.md)，有 `docs/design/window-management.md` 可照抄）。这五条在 GitHub 上打 `good first issue`。
- **提问出口**：开 GitHub Discussions，至少建 `Q&A` 与 `Ideas` 两个类别，并在 `.github/ISSUE_TEMPLATE/config.yml` 的 `contact_links` 里加一条指向它；`blank_issues_enabled: false` 保持不变。`about` 一行写明「先查 `docs/TROUBLESHOOTING.md`，查不到再问」。
- **协作语言**：`CONTRIBUTING.md` 顶部写明本项目以中文协作；同时按 §9 第 3 条决定提交信息的语言政策。
- **`CONTRIBUTING.md` 新增两节**：样例图库（指向 §4.2 的命令与造出来的目录结构）、`.agents/skills/` 的定位（编码代理的工作流，人类贡献者可选读，不是必读）。

### 4.6 门面：截图、徽章与英文入口

- **截图**按 `README.md` 现有功能列表取五张：任务管理页（运行中任务、进度与阶段描述、导航栏角标）、图组管理页的平铺视图（两级展开相册）、脚本管理页（常驻编辑器与底部状态栏）、图片查看器（缩略图导航条）、暗色主题下的图库页。静态 PNG 放 `docs/images/`，交互性强的（平铺展开、滚轮缩放、任务进度推进）用 GIF 且只保留最短必要片段；宽度统一，单张不超过约 500 KB；每张在功能列表里就近引用，不做集中图集。
- **截图数据一律来自样例图库**，不截真实角色图与本地路径，角色名用虚构值，并在截完后逐张检查角落里的路径显示。
- **徽章**：补一个指向 `verify.yml` 的 CI 状态徽章放在徽章组第一位；现有徽章整组校对版本号。不新增下载量、代码行数一类无信息量的徽章。
- **英文入口**：新增 `README.en.md` 与 `README.md` 顶部互链，覆盖一句话定位、截图、功能简表、安装与快速开始、脚本系统一段、文档入口、贡献方式，**顶部写明「中文版为准」**，细节一律链回中文文档；`CONTRIBUTING.md` 顶部加一段英文摘要。

### 4.7 治理与发布流程的可见性

- **`CODEOWNERS`**：默认 `*` 归维护者，把 `src/main/ups/`、`src/main/database/`、`src/main/task/` 单列作为「改动前先开 Issue 讨论」的提示——这三处会动数据与任务不变量。不配分支保护：单人维护下强制 review 只会拖慢自己。
- **标签**：`good first issue` / `help wanted` / `bug` / `enhancement` / `dependencies`（`dependabot` 已在用后两个）+ `area:main` / `area:renderer` / `area:docs` / `area:build`；映射规则写进 `docs/roadmap/README.md`，与 §4.5 新增的两列对应。
- **响应预期**：`CONTRIBUTING.md` 写明维护者处理 Issue 与 PR 的通常节奏，措辞可照 `SECURITY.md` 已有的「3 个工作日」。
- **发布流程**：`CONTRIBUTING.md` 加一节说明版本由维护者按 `.agents/skills/gitflow-release/SKILL.md` 的流程发布（`develop` → `release/<x.y>` → 合入 `master` → 打 tag → CI 出三平台产物），并明确贡献者的职责边界——**只需在 `CHANGELOG.md` 的 `[未发布]` 段补条目，不需要关心版本号与发布段**。

## 5. 改动清单

| 位置 | 改动 |
|---|---|
| `CODE_OF_CONDUCT.md`、`SECURITY.md` | 联系方式改成只走 GitHub 私密通道；`SECURITY.md` 的支持范围更新到当前版本 |
| `scripts/check-docs.mjs` | 占位符规则扩到尖括号形态；文件头检查项说明同步改写 |
| `CONTRIBUTING.md` | 修分支名；平台范围与 `README.md` 统一；自检清单补 `check-docs.mjs` 并改为引用 `AGENTS.md`；新增「不知道从哪开始」「样例图库」两节；补协作语言、响应预期、发布流程与职责边界、`.agents/skills/` 定位；顶部英文摘要；常用命令表补新命令 |
| `README.md` | 徽章与打包示例的版本号订正；功能列表就近插入截图；补 CI 状态徽章；与 `README.en.md` 互链 |
| `.github/dependabot.yml` | `image` 分组删掉已不存在的 `jimp` 系条目 |
| **新增** `scripts/make-fixture.mjs` | 生成样例图库到 `dist/fixture/` |
| **新增** `docs/images/` | 截图与 GIF（**新增目录，按 `AGENTS.md` 先确认**） |
| **新增** `README.en.md` | 入口级英文说明，顶部标注「中文版为准」 |
| **新增** `.github/CODEOWNERS` | 默认归属 + 三个高风险目录单列 |
| **新增** `.nvmrc`、**新增** `yarn.lock` | 固定 Node 版本；锁文件入库 |
| `.gitignore` | 删掉 `/yarn.lock` |
| `package.json` | 补 `engines.node`（**由使用者执行**） |
| `.github/workflows/verify.yml` | 拆成 `docs` / `check` / `verify` 三个作业；安装改 `--frozen-lockfile` |
| `.github/workflows/release.yml` | 安装改 `--frozen-lockfile` |
| `.github/ISSUE_TEMPLATE/config.yml` | 加 Discussions 链接 |
| `docs/roadmap/README.md` | 「事项」表加「难度」「涉及」两列并逐条填；补标签映射规则 |
| `AGENTS.md` | 「已知环境限制」改写 `yarn.lock` 那一条；「改完必须自检」补检查脚本的位置 |
| GitHub 仓库设置 | 开启 Discussions；建标签；确认 `CODEOWNERS` 生效 |

## 6. 实施顺序

分四级。**P0 是唯一「现在就在对外造成负面印象」的一档**；其余按「能不能跑通 → 能不能改对 → 知不知道改什么 → 被不被看见」推进，正对应 §2.1 的三处摩擦与 §2.4 的条件。

| 级别 | 内容 | 工作量 | 直接收益 |
|---|---|---|---|
| **P0** | 对外事实与占位符修正（§4.1） | 半天 | 止损：不再对外展示死邮箱与错文档 |
| **P1-a** | 样例图库 + `CONTRIBUTING.md` 上手内容（§4.2、§4.5） | 1 天 | 贡献者第一次能真正跑通全流程 |
| **P1-b** | 锁文件入库 + 工具链版本固定（§4.3） | 1 小时 | 构建可复现，「本地好的、CI 挂的」可归因 |
| **P1-c** | 规范检查脚本 + CI 拆作业（§4.3、§4.4） | 2–3 天 | 规则从「约定」变成 CI 红线 |
| **P1-d** | 测试系统（[test-system.md](./test-system.md)，不在本条目内） | 3–5 天 | 敢改、敢合 |
| **P2** | 路线图可认领度、起步项 Issue、Discussions、`CODEOWNERS`、标签（§4.5、§4.7） | 2–3 天 | 「想帮忙」的人有明确入口 |
| **P3** | 截图、CI 徽章、英文 README（§4.6） | 1–2 天 | 被看见、被信任 |

**先做哪五件**：两个空邮箱 → `CONTRIBUTING.md` 的分支名与平台口径 → 样例图库 → `yarn.lock` 入库 → 测试系统。前两件半天能修完，是唯一「现在就在造成负面印象」的东西；后三件决定这个项目能不能从「一个人的作品」变成「别人敢改的项目」。

## 7. 风险

| 风险 | 应对 |
|---|---|
| 统一平台口径或改自检清单时改了一处漏了另一处 | 按 §8 第 3 条的核对清单逐项过，四处一起看 |
| 扩占位符检查后误伤文档里演示的 `<占位>` 语法 | 规则只匹配 `待填写` / `TODO` 一类词根，不匹配任意尖括号；扩完在仓库里跑一次看是否误报 |
| 样例图库随功能演进而失效 | 把「样例图库仍能走通全流程」写进 `CONTRIBUTING.md` 的手工冒烟项；脚本保持零依赖、只描述目录不描述业务 |
| 首次跑规范检查暴露存量违规（命名空间导入、单行 `if`） | 先只统计不修，看清规模；存量按模块分批清，避免一次大改盖住真实 diff |
| 渲染进程的 Node 模块判断误伤 `electron` | 按 `AGENTS.md` 的既有例外显式放行，并在脚本里注释写明这是设计如此 |
| 锁文件入库后依赖升级变成显式 diff | 这正是目的；`dependabot` 已在发 PR，锁文件随 PR 更新 |
| 截图泄露真实数据（角色名、本地路径、图库目录名） | 只用样例图库；统一替换为虚构值后逐张检查 |
| 英文文档与中文文档不同步，逐渐失真 | 英文只保留入口级内容，细节全部链回中文；顶部写明以中文版为准 |
| 外部贡献者把 `.agents/skills/` 当成必读规范 | 在 `CONTRIBUTING.md` 明确定位为编码代理工作流，人类可选读 |

## 8. 验证方法

1. **占位符检查的反例**：把 `CODE_OF_CONDUCT.md` 的邮箱临时改回 `<待填写>`，`node scripts/check-docs.mjs` 必须报出问题；验完改回来。`git grep -n 待填写` 应无输出。
2. **规范检查的反例**（每条各造一个，验完删掉）：一个 `import * as x from 'node:path'`、一个不带大括号的 `if`、一个渲染进程里的 `import fs from 'fs'`、一个 `src/main/database/` 里的 `@/ups` 导入——脚本必须各报一条，且整个渲染进程跑一遍除 `electron` 外没有额外告警。
3. **一致性核对**：分支名（`CONTRIBUTING.md` 的分支表 ↔ `verify.yml` 的 trigger）；平台范围（`CONTRIBUTING.md` ↔ `README.md` ↔ `release.yml` 的矩阵）；版本号（`README.md` ↔ `SECURITY.md` ↔ `package.json`）；`dependabot.yml` 每个分组至少能匹配到 `package.json` 里的一个依赖。
4. **锁文件**：干净 clone 上 `yarn install --frozen-lockfile` 成功，改 `yarn.lock` 一行后重跑失败。
5. **样例图库**：`node scripts/make-fixture.mjs` 后能走通「添加来源 → 扫描 → 选图 → 导出」，且损坏文件与非图片文件的表现在任务结果里可解释。
6. **门面**：匿名窗口打开仓库首页——截图正常渲染、CI 徽章显示通过、首屏无破图；从 `README.en.md` 能一路点到安装方式、脚本文档与贡献指南，语言切换双向可用。
7. **治理**：`CODEOWNERS` 语法通过（Code owners 页面无报错）；提一个测试 PR，`area:*` 标签生效、review 请求落到预期的人。

## 9. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 平台支持范围：Windows 单平台，还是三平台 | 按三平台写。`README.md` 的打包一节与 `release.yml` 的矩阵已经是三平台，改文档比改构建便宜；但要在环境要求里区分「出得了产物」与「日常验证过」 |
| 2 | 何时切到 ESLint | 暂不引入。等规则数量超出一屏、或需要格式化与自动修复时再评估；届时新增的是 `eslint` + `typescript-eslint` + `eslint-plugin-vue` + `vue-eslint-parser` 一组依赖，需要使用者批准 |
| 3 | 提交信息是否允许英文 | 允许。中文提交信息是当前维护者的习惯，不是必须的协作门槛；外部 PR 的提交信息由维护者统一改写即可 |
| 4 | 样例图库放 `dist/fixture/` 还是仓库内 `fixtures/` | 放 `dist/fixture/`，不进版本库；仓库内只保留生成脚本 |
| 5 | 截图放 `docs/images/` 还是仓库根 `assets/` | `docs/images/`，与文档同层（**新增目录需先确认**） |
| 6 | 起步项要不要做成 Issue 而不是只写在 `CONTRIBUTING.md` | 做成 Issue：贡献者点进去应该是一个可认领的 Issue，而不是一份方案文档 |
| 7 | `docs/requirements.md`（349 行，`README.md` 自注「部分已被实现取代」）是否归档 | 倾向移到 `docs/archive/` 并在 `docs/README.md` 的层级表里加一行。**涉及移动文件，按 `AGENTS.md` 先定方案再动** |
