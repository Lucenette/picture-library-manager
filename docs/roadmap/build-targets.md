# 构建目标：32 位与 arm 架构

**状态**：待评审（本次只登记需求，第 3 节的条目核实完才谈方案）
**关联**：[.github/workflows/release.yml](../../.github/workflows/release.yml)、[AGENTS.md](../../AGENTS.md) 的「已知环境限制」

---

## 1. 背景

1. **现有构建目标只有 x64，macOS 多一个 arm64。** `electron-builder.yml` 里：Windows 的 NSIS 是 `arch: [x64]`；macOS 的 dmg 是 `arch: [x64, arm64]`；Linux 的 AppImage 与 deb **没写 arch**，跟随宿主（CI 上是 x64）。
2. **arm 的诉求可预期**：Windows on ARM 与 Linux arm64（ARM 服务器、树莓派、部分信创机型）。Windows 与 macOS 上的 x64 包靠模拟层还能跑（非原生），Linux arm64 上则无法直接运行。
3. **32 位不是加一行配置的事**：Electron 与原生依赖（尤其 `sharp`）各自的架构支持是硬约束；而 `electron-builder.yml` 里 `npmRebuild: false`，换架构打包时原生模块不会自动换成对应架构的二进制。
4. **产物还要能区分**：现在 `artifactName` 只带版本号，多架构并行构建会出现同名文件（macOS 已经是两个 dmg）。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-28 | 首次记录（仅登记需求，事实核实待做） | — |

---

## 2. 目标与非目标

**目标**

1. Windows 与 Linux 也提供 arm64；32 位在 Electron 与 `sharp` 都支持的前提下提供。
2. 产物文件名带架构，Release 附件不重名。
3. 发布工作流的构建矩阵覆盖新增目标。

**非目标**

- 不做 `electron-updater` 的多架构适配；不引入代码签名。

## 3. 待核实（先验证，再谈方案）

| # | 事项 | 怎么验 |
|---|---|---|
| 1 | Electron 44 还发布哪些架构：`win32-ia32`、`win32-arm64`、`linux-arm64`、`linux-armv7l` | 试打包，或查 Electron 的发布清单 |
| 2 | `sharp` 有没有对应架构的预编译包（32 位最可疑） | 查它的预编译清单，或按架构安装一次 |
| 3 | `npmRebuild: false` 下换架构打包，原生模块会不会跟着换 | 打一次 arm64 包，检查包内 `sharp` 二进制的架构 |
| 4 | 32 位进程的内存上限对大图扫描的影响 | 与扫描的内存预算逻辑一并评估（`task-process.md` 里有相关记录） |

## 4. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 先加哪些目标 | 先 arm64（Windows / Linux）；32 位等第 3 节核实完再定 |
| 2 | 产物命名 | `artifactName` 统一带上 `${arch}` |
| 3 | Windows arm64 是否出 NSIS 安装包 | 跟着 Electron 的支持情况走 |
