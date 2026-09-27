---
name: gitflow-release
description: 使用者说「发布」「发版」「release」（可能带版本号，如「发布 1.2.0」）时使用——走 gitflow 的 release 流程把 develop 合并到 master、按需要决定是否在 master 的合并提交上打 v〈版本〉标签（推了 tag 才触发三平台构建与 Release）、回 develop 把开发版号提到下一个补丁位。只发 x/y 版本，z 补丁只在不得不发时发。只做本地操作，推送交给使用者。
---

# 发布（gitflow release）

## Summary

本仓库用 gitflow 管分支：`develop` 是开发线，`master` 只承载已发布状态。一次发布是三件事——**把 develop 合进 master**、
**（可选）在 master 的那个提交上打 `v<版本>` 标签**、**回 develop 把开发版号提升到下一个补丁位**。

**只发 x/y 版本**：major 与 minor 才发布；`z` 补丁只在不得不发时发。平时演进时 develop 的版号照常按 `z` 自增，
但那**只是开发标记**——不建 CHANGELOG 小节、不打 tag、不发产物。

**合并与打 tag 是两步**：不打 tag 就不会触发 [.github/workflows/release.yml](../../../.github/workflows/release.yml)
（它只在推送 `v*` tag 时构建三平台并建 Release）。所以「先把版本落到 master，验证过再补 tag」是合法顺序。

**只做本地操作，不推送**——推送与推 tag 交给使用者，最后把命令交给他。

## Table of Contents

- [发布策略](#发布策略)
- [前置检查](#前置检查)
- [标准流程](#标准流程)
- [受限环境下的等价手工步骤](#受限环境下的等价手工步骤)
- [版本号与更新日志的两态](#版本号与更新日志的两态)
- [与数据库版本目录的关系](#与数据库版本目录的关系)
- [验证](#验证)
- [失败与回滚](#失败与回滚)
- [不能做的事](#不能做的事)

## 发布策略

| 版本位 | 什么时候发 |
|---|---|
| `x`（major） | 破坏性变更 |
| `y`（minor） | 新功能（本仓库的常态：一条功能线做完） |
| `z`（patch） | **默认不发**；只有不得不发时才发（线上坏了、装不上、数据出问题这类） |

- develop 的版号每发一次就提到下一个 `z`（`1.1.0` → `1.1.1`），那是**开发标记**，不是待发布版本。
- 下一次发布取下一个 `x`/`y`（`1.1.0` 之后是 `1.2.0`），在 release 分支上把 `package.json` 提到它。
- 因为中间的 `z` 不发、也就不建它们的 CHANGELOG 小节，`## [未发布]` 会一直累积到下一个被发布的版本；定稿时它整段变成发布版本的小节。
- **合并由脚本保证，不靠人记**：`scripts/release-notes.mjs` 以「最近一个 tag」为界，把之后的所有小节按版本顺序拼起来——
  中间那些没发布、甚至已经落到 master 但没打 tag 的版本都不会漏（多节时按 `### [版本]` 分块、节内标题降一级）。

## 前置检查

1. 工作区干净（`git status`）；有未提交改动先问清楚再动。
2. 在 `develop` 上；`git fetch` 后看 `git status -sb` 是否落后于 `origin/develop`（沙箱里常常连不上远端，连不上就说明并只按本地状态走）。
3. gitflow 配置齐全：`gitflow.branch.master=master`、`gitflow.branch.develop=develop`。
4. **`gitflow.prefix.versiontag` 必须是 `v`**。它是空的时候 tag 会叫 `1.0.0`，而 CD 只认 `v*`，既有 tag 也是 `v0.0.1`。
   一次设置即可：`git config gitflow.prefix.versiontag v`
5. **本次发布的版本号**：默认取下一个 `x`/`y`（见「发布策略」）；使用者指定了版本就以指定的为准。
6. 发布门禁，全过才往下走：`yarn typecheck`、`node scripts/check-docs.mjs`；有数据库改动时再跑
   `node .agents/skills/db-maintenance/scripts/verify-migration.mjs`。

## 标准流程

1. **起 release 分支**：`git flow release start <版本>` → 得到 `release/<版本>`。
2. **版号与更新日志定稿**（在 release 分支上，一次提交 `文档：更新日志定稿 <版本>`）：
   - 把 `package.json` 的 `version` 改成本次发布版本（下一个 `x`/`y`）；
   - 把 `CHANGELOG.md` 顶部的 `## [未发布]` 改成 `## [<版本>] - <今天>`，链接定义改成
     `[<版本>]: https://github.com/Lucenette/picture-library-manager/releases/tag/v<版本>`；
   - 上次发布之后若有已写小节但没发布的版本，把它们并入本节。
3. **发布收尾**：release 分支上只做与发布有关的改动。没有就跳过。
4. **合并进 master**：`git switch master` → `git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>'"`。
5. **打 tag（可选这一步）**：要出产物就打，且必须打在 master 的那个合并提交上：
   `git tag -a v<版本> -m "Release <版本>"`。不打就停在这里——版本已经落在 master，产物等验证通过后再补。
6. **合并回 develop 并删分支**：`git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>' into develop"`，
   然后 `git branch -d release/<版本>`。结束时停在 develop，不是的话先切回去。
7. **提升开发版号**（在 develop，一次提交 `版本：开发版号提升到 <下一个版本>`）：
   - `package.json` 提到下一个补丁位（`1.1.0` → `1.1.1`）；
   - 给 `CHANGELOG.md` 顶部补回空的 `## [未发布]`，比较链接的基线用**最近一个打过 tag 的版本**
     （刚发布但没打 tag 时基线仍是上一个 tag，否则链接指向不存在的 tag）。
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

- **develop 的 `package.json`**：下一个补丁位，开发标记，不会单独发布；**master 的**：刚落地的发布版本。两者相差一个补丁位。
- `CHANGELOG.md` 在两条线上内容相同（已发布段 + 空的未发布段），差别只在链接定义指向哪里。
- 发布说明由 `scripts/release-notes.mjs` 生成：它以**最近一个 tag**（`git describe --tags --abbrev=0`）为界，把之后的所有
  CHANGELOG 小节合并成「更新详情」；找不到那个 tag 对应的小节时退回按版本号比较，环境里没有 git 时全部带上，
  空小节（刚定稿后补回的 `[未发布]`）不进结果。

## 与数据库版本目录的关系

- 新的结构变更写进 `changesets/<当时 package.json 的版本号>/`（见 [db-maintenance](../db-maintenance/SKILL.md)）。
  发布号通常是下一个 `x`/`y`，与它不一致——**账本身份取目录里 `VERSION` 常量，与目录名无关**，所以不一致不影响运行。
- 为可读性，发布时可以把版本目录改成发布号（`1.0.1` → `1.1.0` 就是这么做的），
  **但绝不能改 `VERSION`**：已经记过账的身份一改，那些 changeSet 就会被当成新的重跑，而 `ALTER TABLE` 重复执行会失败。

## 验证

1. `git log --oneline --graph master develop -8` 能看到两条合并线，`release/<版本>` 已不存在。
2. `git show master:package.json` 的 version = 发布版本；`git show develop:package.json` = 下一个版本。
3. 打了 tag 时：`git tag -l` 里有 `v<版本>`，且 `git merge-base --is-ancestor v<版本>^{commit} master` 成立——这是 CD 的硬要求。
4. `git status` 干净，停在 `develop`，可以继续开发。
5. 发布说明可以本地预演：在 master 上跑 `node scripts/release-notes.mjs`，确认「更新详情」是本次版本那一节、且包含上次发布以来的全部条目。

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
