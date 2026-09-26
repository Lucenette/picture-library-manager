---
name: gitflow-release
description: 使用者说「发布」「发版」「release」（可能带版本号，如「发布 1.1.0」）时使用——走 gitflow 的 release 流程把 develop 发布到 master、在 master 的那个提交上打 v〈版本〉标签、回到 develop 把开发版号提到下一个补丁版本。只做本地操作，推送交给使用者。
---

# 发布（gitflow release）

## Summary

本仓库用 gitflow 管分支：`develop` 是开发线，`master` 只承载已发布状态。一次发布就是三件事——
**把 develop 合进 master**、**在 master 的那个提交上打 `v<版本>` 标签**、**回 develop 把版号提到下一个**（默认补丁位 +1）。
标签推上去之后，[.github/workflows/release.yml](../../../.github/workflows/release.yml) 会自动构建三平台并建 Release。

**只做本地操作，不推送**——推送由使用者自己来，最后把命令交给他。

## Table of Contents

- [前置检查](#前置检查)
- [标准流程](#标准流程)
- [受限环境下的等价手工步骤](#受限环境下的等价手工步骤)
- [版本号与更新日志的两态](#版本号与更新日志的两态)
- [验证](#验证)
- [失败与回滚](#失败与回滚)
- [不能做的事](#不能做的事)

## 前置检查

1. 工作区干净（`git status`）。`data/single.js` 是本仓库长期未跟踪的文件，可以忽略；其它未提交改动先问清楚再动。
2. 在 `develop` 上，且不落后于 `origin/develop`（`git fetch` 后看 `git status -sb`）。
3. gitflow 配置齐全：`gitflow.branch.master=master`、`gitflow.branch.develop=develop`。
4. **`gitflow.prefix.versiontag` 必须是 `v`**。它是空的时候 tag 会叫 `1.0.0`，而 CD 只认 `v*`，既有 tag 也是 `v0.0.1`。
   一次设置即可：`git config gitflow.prefix.versiontag v`
5. 版本号取自 `package.json` 的 `version`。使用者指定了版本（如「发布 1.1.0」）就以指定的为准。
6. 发布门禁，全过才往下走：`yarn typecheck`、`node scripts/check-docs.mjs`；
   有数据库改动时再跑 `node .agents/skills/db-maintenance/scripts/verify-migration.mjs`。

## 标准流程

1. **更新日志定稿**（在 develop）：把 `CHANGELOG.md` 顶部的 `## [未发布]` 改成 `## [<版本>] - <今天>`，
   并把 `[未发布]` 的链接定义改成 `[<版本>]: https://github.com/Lucenette/picture-library-manager/releases/tag/v<版本>`。
   提交：`文档：更新日志定稿 <版本>`。
2. **起 release 分支**：`git flow release start <版本>` → 得到 `release/<版本>`。
3. **发布收尾**：release 分支上只做与发布有关的改动（版号、更新日志、发布前必修的缺陷）。没有就跳过。
4. **合并并打标签**：`git flow release finish -m "Release <版本>" <版本>`。
   它做的事情是：合并进 `master` → 在 master 的那个提交上打 `v<版本>` → 合并回 `develop` → 删掉 release 分支。
   结束时通常停在 `develop`，不是的话先 `git switch develop`。
5. **提升开发版号**（在 develop）：把 `package.json` 的 `version` 提到下一个，默认补丁位 +1（`1.0.0` → `1.0.1`）。
   使用者说了「minor」「major」或具体版本时按他说的来。
6. **补回未发布段**（在 develop）：`CHANGELOG.md` 顶部加回空的 `## [未发布]`，链接定义改成
   `[未发布]: https://github.com/Lucenette/picture-library-manager/compare/v<版本>...HEAD`。第 5、6 步可以合成一次提交：
   `版本：开发版号提升到 <下一个版本>`。
7. **不推送**。按「验证」核对后，把命令交给使用者：

   ```bash
   git push origin master
   git push origin develop
   git push origin v<版本>        # 推这个 tag 会触发发布工作流
   ```

## 受限环境下的等价手工步骤

`git flow` 是 bash 脚本：在 agent 沙箱里 `sh.exe` 会被拒（`couldn't create signal pipe, Win32 error 5`，退出码 66），
使用者自己的终端里正常。**无法执行 `git flow` 时**用下面这套等价操作，并在回复里说明走的是手工路径：

```bash
git switch -c release/<版本> develop
# …发布收尾提交…
git switch master
git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>'"
git tag -a v<版本> -m "Release <版本>"      # 必须打在刚才那个 master 提交上
git switch develop
git merge --no-ff release/<版本> -m "Merge branch 'release/<版本>' into develop"
git branch -d release/<版本>
```

两条路径要保证的不变量是同一组：**tag 指向 master 的那个提交**、release 的内容进了两条线、release 分支被删掉。
合并形状（是否 `--no-ff`）以本机 `git flow` 的配置为准，不影响这些不变量。
既有的 `v0.0.1` 是轻量标签；新标签用附注标签，带日期、打标签者与说明。

## 版本号与更新日志的两态

- **develop 的 `package.json`**：正在开发的下一个版本；**master 的**：刚落地的发布版本，两者相差一个补丁位。
- 发布后 develop 的版本号变了，此后**新的数据库结构变更要写进 `changesets/<新版本号>.xml`**（见 `db-maintenance` skill）。
- `CHANGELOG.md` 在两条线上内容相同（已发布段 + 空的未发布段），差别只在链接定义指向哪里。

## 验证

1. `git tag -l` 里有 `v<版本>`；`git merge-base --is-ancestor v<版本>^{commit} master` 成立——这是 CD 的硬要求。
2. `git log --oneline --graph master develop -8` 能看到两条合并线，`release/<版本>` 已不存在。
3. `git show master:package.json` 的 version = 发布版本；`git show develop:package.json` = 下一个版本。
4. `git status` 干净，且在 `develop` 上，可以继续开发。

## 失败与回滚

- **finish 之前出错**：`git flow release delete <版本>`（手工路径则删掉 `release/<版本>` 分支），回到起点重来。
- **master 已合并但 tag 没打上**：切到 master，`git tag -a v<版本> -m "Release <版本>"`——tag 必须指向那个合并提交。
- **tag 打错**：只要还没推送，`git tag -d v<版本>` 之后重打；**已经推出去的 tag 不要移动**，发布工作流可能已经用过它。
- **合并冲突**：在 release 分支上解决后重做该合并步骤；不要用 `-X ours/theirs` 把冲突悄悄压掉。

## 不能做的事

- **不要推送**：本仓库的推送由使用者自己执行。
- 不要 force push、不要移动已推送的 tag、不要在 `master` 上直接提交代码。
- 发布门禁没过就不算发布完成——不要把类型检查、文档检查、迁移预演跳过。
