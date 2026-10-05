# 被上游卡住的依赖升级

**状态**：等上游
**关联**：[.github/dependabot.yml](../../.github/dependabot.yml)（屏蔽规则）、[AGENTS.md](../../AGENTS.md)（自检清单）

## 背景

dependabot 只看版本号，既看不到 **peer 上限**，也读不到 release notes 里的破坏性变更。于是这几个包会周期性推出"升了必然坏"的 PR——与其每次手动关，不如在 [.github/dependabot.yml](../../.github/dependabot.yml) 里显式 `ignore`，并把"为什么现在不能升、什么时候能升"记在这里。

## 事项

| 包 | 屏蔽范围 | 卡在谁 | 解开条件 |
|---|---|---|---|
| `typescript` | `>=6.1.0` | `typescript-eslint` 的 peer 是 `>=4.8.4 <6.1.0`（类型感知规则直接调 TS 编译器 API） | `npm view typescript-eslint peerDependencies.typescript` 的上限放到 7 |
| `vite` | `>=8.0.0` | `electron-vite@5` 的 peer 上限是 `vite ^7` | `npm view electron-vite peerDependencies.vite` 放开到 8 |
| `vite-plugin-electron-renderer` | `>=1.0.0` | 1.0.0 起的破坏性变更是 *Drop Vite < 8 support* | 与上一条同源：`electron-vite` 支持 Vite 8 后一起升 |

实测记录（2026-10-05）：`typescript` 的 `latest` 是 7.0.2（2026-07-08 转正，已三个月），`typescript-eslint` 上游 8.71.1 仍写 `<6.1.0`；`eslint` 本身跟得很快（上游 10.12.0），慢的不是它。

## 解开一条要做什么

1. 按表中命令确认上游已放开；
2. 从 `.github/dependabot.yml` 的 `ignore` 删掉对应条目；
3. 升级，并**把自检跑齐**——尤其 `yarn lint`（TS 大版本最容易打断类型感知规则）与 `electron-vite build`（Vite 大版本会动构建器）；
4. 删掉本文件里对应的一行；三条都清了就删掉本文件，并从 [README.md](./README.md) 的索引里摘掉。
