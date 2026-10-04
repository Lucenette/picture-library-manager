---
name: gitflow-release
description: 使用者说「发布」「发版」「release」（可能带版本号，如「发布 1.2.0」）时使用——走 gitflow 的 release 流程把 develop 合并到 master、按需要决定是否在 master 的合并提交上打 v〈版本〉标签（推了 tag 才触发三平台构建与 Release）、回 develop 把版本号提到下一次 release（develop 的 package.json 版本号即下一次 release 的版本号）。只做本地操作，推送交给使用者。
---

# 发布（gitflow release）

## Summary

本仓库用 gitflow 管分支：`develop` 是开发线，`master` 只承载已发布状态。一次发布是三件事——**把 develop 合进 master**、
**（可选）在 master 的那个提交上打 `v<版本>` 标签**、**回 develop 把版本号提到下一次 release**。

**develop 的 `package.json` 版本号就是下一次 release 的版本号**，任何时候都确定：CHANGELOG 顶部的 `## [<版本>] - 未发布` 与它一致，定稿时只把 `未发布` 换成日期，版本号不动。发布过的 release 把下一版提到 `x.(y+1).0`；只 release 没发布的停在 `x.y.(z+1)`；升 `x` 由维护者另行显著告知。

**合并与打 tag 是两步**：不打 tag 就不会触发 [.github/workflows/release.yml](../../../.github/workflows/release.yml)
（它只在推送 `v*` tag 时构建三平台并建 Release）。所以「先把版本落到 master，验证过再补 tag」是合法顺序。

**只做本地操作，不推送**——推送与推 tag 交给使用者，最后把命令交给他。

## Table of Contents

- [发布策略](#发布策略)
- [前置检查](#前置检查)
- [标准流程](#标准流程)
- [受限环境下的等价手工步骤](#受限环境下的等价手工步骤)
- [版本号与更新日志的两态](#版本号与更新日志的两态)
- [更新日志怎么写](#更新日志怎么写)
- [版本小节的链接](#版本小节的链接)
- [与数据库版本目录的关系](#与数据库版本目录的关系)
- [验证](#验证)
- [失败与回滚](#失败与回滚)
- [不能做的事](#不能做的事)

## 发布策略

| 版本位 | 什么时候发 |
|---|---|
| `x`（major） | 破坏性变更 |
| `y`（minor） | 新功能（本仓库的常态：一条功能线做完） |
| `z`（patch） | 上一次 release 没发布时接上的补丁位；它本身也可以发布 |

- **develop 的 `package.json` 版本号 = 下一次 release 的版本号**，随时可查，不需要在 release 分支上另定版本。
- 一次 release 收尾时按是否发布决定下一版号：
  - **release 并发布**（在 master 打了 `v<版本>` tag）→ 提到 `x.(y+1).0`（`1.1.1` → `1.2.0`）；
  - **只 release 不发布**（未打 tag）→ 提到 `x.y.(z+1)`（`1.1.1` → `1.1.2`）；
  - 需要升 `x`（破坏性变更或重大架构升级）时由维护者另行告知。
- CHANGELOG 顶部始终是 `## [<下一次版本>] - 未发布`；定稿时只把 `未发布` 换成日期，版本号不变。
- **合并由脚本保证，不靠人记**：`scripts/release-notes.mjs` 以「最近一个 tag」为界，把之后的所有小节按版本顺序拼起来——
  中间那些没发布、甚至已经落到 master 但没打 tag 的版本都不会漏（多节时按小节名合并成一组，内部版本号不出现在发布说明里）。

## 前置检查

1. 工作区干净（`git status`）；有未提交改动先问清楚再动。
2. 在 `develop` 上；`git fetch` 后看 `git status -sb` 是否落后于 `origin/develop`（沙箱里常常连不上远端，连不上就说明并只按本地状态走）。
3. gitflow 配置齐全：`gitflow.branch.master=master`、`gitflow.branch.develop=develop`。
4. **`gitflow.prefix.versiontag` 必须是 `v`**。它是空的时候 tag 会叫 `1.0.0`，而 CD 只认 `v*`，既有 tag 也是 `v0.0.1`。
   一次设置即可：`git config gitflow.prefix.versiontag v`
5. **本次发布的版本号**：取 develop 的 `package.json` 版本号（见「发布策略」）；使用者另行指定了版本，才在 release 分支上改 `package.json` 与 CHANGELOG 顶部的 `[<版本>]`。
6. 发布门禁，全过才往下走：`yarn typecheck`、`node scripts/check-docs.mjs`；有数据库改动时再跑
   `node .agents/skills/db-maintenance/scripts/verify-migration.mjs`。

## 标准流程

1. **起 release 分支**：`git flow release start <版本>` → 得到 `release/<版本>`。
2. **更新日志定稿**（在 release 分支上，一次提交 `文档：更新日志定稿 <版本>`）：
   - `package.json` 的 `version` 已经是本次发布版本，不用改；仅当使用者另行指定了版本才在这里改；
   - 把 `CHANGELOG.md` 顶部的 `## [<版本>] - 未发布` 改成 `## [<版本>] - <今天>`；**链接不动**，它要到发布时才改（见「版本小节的链接」）；
   - 确认顶部小节就是本次发布的内容，缺的条目补上。
3. **发布收尾**：release 分支上只做与发布有关的改动。没有就跳过。
4. **合并进 master**：`git switch master` → `git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>'"`。
5. **打 tag（可选这一步）**：要出产物就打，且必须打在 master 的那个合并提交上：
   `git tag -a v<版本> -m "Release <版本>"`。不打就停在这里——版本已经落在 master，产物等验证通过后再补。
   打了 tag 之后按「版本小节的链接」把上一个已发布 tag 之后的小节链接一起改掉。
6. **合并回 develop 并删分支**：`git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>' into develop"`，
   然后 `git branch -d release/<版本>`。结束时停在 develop，不是的话先切回去。
7. **把版本号提到下一次 release**（在 develop，一次提交 `版本：下一次 release 版本号提升到 <下一个版本>`）：
   - `package.json` 按是否发布改（见「发布策略」）：发布了提到 `x.(y+1).0`，只 release 没发布提到 `x.y.(z+1)`；
   - 给 `CHANGELOG.md` 顶部补回 `## [<新版本>] - 未发布`，链接写成 `compare/<最近一个已发布的 tag>...HEAD`——
     基线**从 master 取**（`git describe --tags --abbrev=0 master`）：develop 上没有 tag，直接 `git describe` 会得到过期的版本。
     刚发布但没打 tag 时基线仍是上一个 tag，否则链接指向不存在的 tag。
8. **不推送**。按「验证」核对后，把命令交给使用者：

   ```bash
   git push origin master
   git push origin develop
   git tag -a v<版本> -m "Release <版本>"   # 要发布产物时才打：在 master 上，指向那个合并提交
   git push origin v<版本>                 # 推这个 tag 才会触发发布工作流
   ```

## 受限环境下的等价手工步骤

`git flow` 是 bash 脚本：在 agent 沙箱里 `sh.exe` 会被拒（`couldn't create signal pipe, Win32 error 5`，退出码 66），
使用者自己的终端里正常。**无法执行 `git flow` 时**用下面这套等价操作，并在回复里说明走的是手工路径：

```bash
git switch -c release/<版本> develop
# …版号与更新日志定稿的提交…
git switch master
git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>'"
git tag -a v<版本> -m "Release <版本>"      # 可省：不打 tag 就不会构建产物
git switch develop
git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>' into develop"
git branch -d release/<版本>
```

两条路径要保证的不变量是同一组：release 的内容进了两条线、release 分支被删掉；
**打 tag 时必须指向 master 的那个合并提交**（工作流的 guard 会校验这个 tag 的提交在不在 master 上）。
合并形状（是否 `--no-ff`）以本机 `git flow` 的配置为准，不影响这些不变量。既有的 `v0.0.1` 是轻量标签；新标签用附注标签。

## 版本号与更新日志的两态

- **master 是发布线，tag 只打在它上面；develop 是开发线，不带 tag。** develop 看不到那些 tag 指向的合并提交，所以 `git describe --tags --abbrev=0` 在 develop 上会给出一个**过期的** tag（本仓库现在是 `v0.0.1`）。**任何需要「最近一个发布过的版本」的地方都从 master 取**：`git describe --tags --abbrev=0 master`，或 `git tag --sort=-v:refname | head -1`。
- **`package.json` 的版本号**：develop 上是下一次 release 的版本号；master 上是刚落地的发布版本。发布过的 release 之后 develop 比 master 高一档（master `1.1.1`、develop `1.2.0`），只 release 没发布时可能只高一个补丁位。
- `CHANGELOG.md` 已发布段在两条线上相同；develop 顶部多一个空的 `## [<下一次版本>] - 未发布`，master 没有。
- 发布说明由 `scripts/release-notes.mjs` 生成：它以**最近一个 tag**（`git describe --tags --abbrev=0`）为界，把之后的所有
  CHANGELOG 小节合并成「更新详情」；找不到那个 tag 对应的小节时退回按版本号比较，环境里没有 git 时全部带上，
  空小节（刚定稿后补回的 `## [<下一次版本>] - 未发布`）不进结果。**它只在 master（tag 线）上跑**，
  在 develop 上跑会拿到过期的 tag、把已经发布过的小节也算进来；脚本遇到这种情况会往 stderr 打一行 warning。

## 更新日志怎么写

`CHANGELOG.md` **面向使用者**：程序员要看的细节在 `git log`（提交信息里写了文件、表与根因）与 `docs/design/`。所以——

- **一行一条**，同一功能只占一条；以「使用者能看到什么 / 能做什么」开头，不写实现，也不写推导与背景（那些留给设计文档）。
- **不进正文**：表名与列名、文件与目录路径、IPC 通道、模块名、依赖版本号、构建与 HTML/CSS 细节。
- **必须写明**：数据安全边界（哪些文件丢了会怎样）、界面上的名字变化。
- **需要使用者动手的事单独开一节 `### 升级必读`**（放在版本标题之后、`### 新增` 之前）：写清做什么、什么时候做、不做会怎样——例如旧库要在**升级前**取出，因为 Windows 的覆盖安装会清空安装目录。
- **修复**写现象（使用者遇到的样子），根因留给提交信息。
- **用正式书面语与标准术语**：陈述句、第三人称，不用第二人称与祈使句；用「备份 / 恢复 / 迁移 / 卸载」这类标准说法，不用「取出 / 搬到别处 / 装完就能用」这类口语。
- **平台要写全**：涉及平台差异的说明必须覆盖 Windows / macOS / Linux，或写成与平台无关的说法；只提其中一个，会让其余平台的使用者以为与自己无关。
- 语气与粒度照 `[1.0.0]`、`[0.0.1]` 两节；`## [<下一次版本>] - 未发布` 里的条目也按这个标准写，定稿前再过一遍。

## 版本小节的链接

链接指向**包含这个版本的 Release 页面**；没有就指向永远有效的 diff，别指向不存在的 tag（会 404）。

| 情况 | 链接 |
|---|---|
| 有对应的 Release | `releases/tag/v<该版本>` |
| tag 在但没建 Release | 包含它的最早 Release——`[0.0.1]` → `v1.0.0` |
| 还没发布（只 release） | `compare/<最近一个已发布的 tag>...HEAD` |

定稿不改链接（tag 还不存在）；**发布后**才把上一个已发布 tag 之后的全部小节改成该 release 链接，在开发分支上做、随下次 release 进 master。

## 与数据库版本目录的关系

- 新的结构变更写进 `changesets/<当时 package.json 的版本号>/`（见 [db-maintenance](../db-maintenance/SKILL.md)）。
  现在发布号与目录名一致（都取 `package.json` 的版本号）；即便历史上不一致也**不影响运行——账本身份取目录里 `VERSION` 常量，与目录名无关**。
- 为可读性，发布时可以把版本目录改成发布号（`1.0.1` → `1.1.0` 就是这么做的），
  **但绝不能改 `VERSION`**：已经记过账的身份一改，那些 changeSet 就会被当成新的重跑，而 `ALTER TABLE` 重复执行会失败。

## 验证

1. `git log --oneline --graph master develop -8` 能看到两条合并线，`release/<版本>` 已不存在。
2. `git show master:package.json` 的 version = 发布版本；`git show develop:package.json` = 下一次 release 的版本号，且 CHANGELOG 顶部的 `[<版本>] - 未发布` 与之相同。
3. 打了 tag 时：`git tag -l` 里有 `v<版本>`，且 `git merge-base --is-ancestor v<版本>^{commit} master` 成立——这是 CD 的硬要求。
4. `git status` 干净，停在 `develop`，可以继续开发。
5. 发布说明可以本地预演：**在 master 上**跑 `node scripts/release-notes.mjs`，确认「更新详情」是本次版本那一节、且包含上次发布以来的全部条目。
6. 比较链接与「更新详情」的基线取的是 **master 上最近的 tag**，不是 develop 上 `git describe` 的结果——develop 上没有 tag。

## 失败与回滚

- **finish 之前出错**：`git flow release delete <版本>`（手工路径则删掉 `release/<版本>` 分支），回到起点重来。
- **master 已合并但决定晚点再发**：这是允许的（见「发布策略」）；要发时切到 master 在合并提交上补 tag 即可。
- **tag 打错**：只要还没推送，`git tag -d v<版本>` 之后重打；**已经推出去的 tag 不要移动**，发布工作流可能已经用过它。
- **合并冲突**：在 release 分支上解决后重做该合并步骤；不要用 `-X ours/theirs` 把冲突悄悄压掉。

## 不能做的事

- **不要推送**：本仓库的推送由使用者自己执行。
- 不要 force push、不要移动已推送的 tag、不要在 `master` 上直接提交代码。
- 不要改已经记过账的版本目录里的 `VERSION`。
- 发布门禁没过就不算发布完成——不要把类型检查、文档检查、迁移预演跳过。
