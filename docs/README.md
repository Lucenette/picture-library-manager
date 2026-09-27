# 文档地图

本仓库的文档分几层，**每个事实只有一个家**：属于哪一层就写在哪一层，别处只放链接。写或改文档前先在这里找到位置。

## 层级

| 层级 | 放什么 | 不放什么 |
|---|---|---|
| [README.md](../README.md) | 项目说明与当前行为 | 实现方案（→ `roadmap/`、`design/`） |
| [AGENTS.md](../AGENTS.md) | 每个会话都要在场的标准命令与硬性约定 | 过程性步骤（→ `.agents/skills/`）、背景与理由（→ 本表其余各层） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 跨子系统的结构：进程模型、目录归属、数据流 | 单个子系统的细节（→ `design/`）、代码规范（→ `AGENTS.md`） |
| [roadmap/](./roadmap/) | **尚未实施**的方案 | 已落地的事实（按 `design/README.md` 的约定迁走）、跨子系统结构（→ `ARCHITECTURE.md`） |
| [design/](./design/) | **已落地**子系统的设计说明：为什么是这样、有哪些不变量、改动时注意什么 | 还在讨论的方案（→ `roadmap/`）、代码已经表达清楚的实现细节 |
| [requirements.md](./requirements.md) | 最初的需求规格（顶部注记了哪些已被实现取代） | 当前行为（→ `README.md`、`ARCHITECTURE.md`、`SCRIPTING.md`） |
| [SCRIPTING.md](./SCRIPTING.md) | 处理脚本的编写契约：导出什么、框架怎么识别、可用 API | 脚本引擎的内部实现（→ `design/`） |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 按现象查的排障：怎么确认、根因在哪 | 事故叙事与设计理由（→ `design/`） |
| [.agents/skills/](../.agents/skills/) | 可复用的工作流与判据，按需加载 | 常驻约定（→ `AGENTS.md`）、产品与运行时契约（→ 本表其余各层） |

## 迁移

方案落地后不要删除文件，按 [design/README.md](./design/README.md) 的约定 `git mv` 过去继续被读。
路线图与设计说明各自的写法（状态块、背景与修改历史、正文口径）见
[.agents/skills/doc-convention/](../.agents/skills/doc-convention/SKILL.md)。

## 检查

`node scripts/check-docs.mjs` 检查编码（无 BOM 的合法 UTF-8，含 `ups/changesets/**/dbups.xml`）、相对链接与锚点、
`roadmap/` 与 `design/` 的 README 索引、skill 的 frontmatter、占位符残留。零依赖，CI 与
[AGENTS.md](../AGENTS.md) 的「改完必须自检」都会跑它。
