# 配方

**面向人**的分步操作：按顺序做，每步有可验证的结果。判据与可复用工作流在 [.agents/skills/](../../.agents/skills/)（那是给代理按需加载的）；这里放还没有 skill、或需要人对着终端一步步走的操作。

| 配方 | 用途 |
|---|---|
| [加一条仓库自检](./adding-a-repo-check.md) | 新增 `scripts/check-*.mjs`：写脚本、配用例、接进自检与 CI |

## 已写在别处的操作

- 新增一种任务：见 [ARCHITECTURE.md](../ARCHITECTURE.md) 末尾的五步配方。
- 写版本升级脚本、改动数据库结构：见 [.agents/skills/db-maintenance/](../../.agents/skills/db-maintenance/SKILL.md)。
- 发一个版本：见 [.agents/skills/gitflow-release/](../../.agents/skills/gitflow-release/SKILL.md)。
