# 其余窗口的自绘标题栏

**状态**：待评审（初稿，方案尚未评审）
**关联**：[window-management.md](../design/window-management.md)（主窗口那套已经落地，见其第 7 节）

---

## 1. 背景

1. **同一个应用里有三种窗口外壳。** 主窗口是自绘标题栏（40px、图标槽、失焦变灰）；六个弹窗是
   `frame: false` + Window Controls Overlay + 各页面自己写的一块 36px 拖拽头
   （`BatchProcessDialog` / `ConfirmDialog` / `FileViewerDialog` / `PromptDialog` / `ScanConfigDialog`
   的 `.xxx-header`，`SimilarDialog` 的 `.similar-bar`）；图片查看器则是**系统标题栏**——
   `createViewer()` 没传 `frame`，是唯一一个还带系统标题栏的窗口。
2. **同一个数字散落在七处，而且靠巧合相等。** 弹窗的栏高写死在六个页面的 CSS 里（都是 `36px`），
   `window-manager` 里 overlay 高度的默认值也是 `36`——两者相等是巧合，没有任何机制维持；
   主窗口那对（`--title-bar-height: 40px` ↔ `titleBar.height: 40`）同样只靠注释互指。
   改一处忘一处，表现就是系统按钮在栏里不居中。
3. **失焦变灰只有主窗口有。** `html.window-blurred` 的样式挂在主窗口的 `.title-bar` / `.app-rail` 上，
   弹窗与查看器失焦时毫无反应——同一个应用里出现了两种反馈。
4. **查看器是唯一还带系统标题栏的窗口**：macOS 上它会和主窗口的自绘栏并排出现（一边系统栏、一边自绘栏），
   Windows 上则多出一条灰带，和刚统一好的外观对不上。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-27 | 首次定稿 | — |

---

## 2. 目标与非目标

**目标**

1. 除浮窗宿主外，每个窗口的顶栏都是同一条自绘栏：同一套高度、底色、拖拽区与失焦压暗。
2. 窗口按钮仍由系统画（Windows / Linux 的 WCO、macOS 的红绿灯），不自绘按钮。
3. macOS 上一律不放图标，左端留给红绿灯——与主窗口现在的做法一致。

**非目标**

- 不自绘窗口按钮：那会丢掉 Windows 11 的贴靠布局与 macOS 红绿灯的原生语义。
- 不改 `isControl` 的浮窗宿主（`ensurePopup()`）：下拉菜单没有标题栏，也不该有。
- 不改主窗口已经落地的那一套（除了把它抽成公共件）。

## 3. 设计

### 3.1 现状与目标

| 窗口 | 现在的顶栏 | 目标 |
|---|---|---|
| 主窗口 | 自绘 40px + 图标槽 + 失焦压暗 | 不动，抽成公共件 |
| 图片查看器 | 系统标题栏 | 自绘，与主窗口同规格（高度另定，见第 7 节） |
| 六个弹窗 | `frame: false` + overlay + 页面自带的 36px 拖拽头 | 换成公共栏，栏高改由 `titleBar.height` 一处决定 |
| 浮窗宿主 | 无 | 不动 |

### 3.2 做法

- **抽一条公共栏**：把主窗口 `.title-bar` 那套（拖拽区、`env(titlebar-area-*)` 安全区、macOS 左侧留白、
  macOS 不画图标、失焦压暗）搬进 `src/renderer/components/TitleBar.vue`，主窗口与各窗口都用它。
  它只接收标题文字与"是否画图标"；系统按钮仍由系统画在它上面。
- **规格由主进程给**：各窗口继续用 `window-manager` 的 `titleBar: { height, color }`，
  页面 CSS 不再写死栏高——那条"CSS 变量必须等于 `titleBar.height`"的约束从"每个窗口各记一遍"
  变成"公共件与 `createMain()` 各一处"。
- **失焦压暗跟着公共件走**：`.window-blurred` 的样式挂在公共栏的类名上，于是每个窗口自动获得同一档灰；
  系统窗口按钮那半仍然由主进程改 `setTitleBarOverlay` 的字形色。

### 3.3 小窗口的例外

420px 级的弹窗（扫描配置、确认、输入）在 macOS 上要给红绿灯留出 ~78px，左边被占掉近五分之一，
标题文字基本没有位置；这类窗口是否值得自绘，见第 7 节。倾向：**先只改查看器与现有弹窗的规格**，
小窗口维持现状，等真觉得割裂再统一。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/renderer/components/TitleBar.vue` | 公共标题栏：拖拽、安全区、macOS 留白、不画图标、失焦压暗 |
| `src/renderer/App.vue` | 主窗口改用公共件，删掉本地那份 `.title-bar` 样式 |
| `src/main/window-manager.ts` | `createViewer()` 传 `titleBar`；其余窗口的 overlay 高度以 `titleBar.height` 为准 |
| 六个 `src/renderer/views/dialogs/*.vue` | 顶部换成公共件，删掉各自的栏高与拖拽区样式 |
| `src/renderer/views/image/ImageViewer.vue` | 加公共件；它现在没有任何拖拽区，全靠系统标题栏 |
| `docs/design/window-management.md` | 落地后把这份并进去（`git mv` 到 `docs/design/`） |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 自绘栏抢走页面的点击（拖拽区与 `no-drag`） | 公共件内部就把可点元素标成 `no-drag`，页面不用再记这条规则 |
| 查看器是键盘驱动的看图窗口，多一条栏会挤掉图片高度 | 栏高压到 36，且全屏时隐藏（见第 7 节） |
| 窄弹窗里标题文字与系统按钮打架 | 见 3.3：小窗口可以只保留拖拽区、不画文字 |
| 两处高度约定（CSS 变量 ↔ `titleBar.height`）仍然可能失配 | 收敛到公共件与 `createMain()` 各一处，并在两处注释互指 |

## 6. 验证方法

1. 静态：`yarn typecheck`、`node scripts/check-docs.mjs`。
2. 人工冒烟（三个平台各一遍）：每个窗口拖得动、按钮点得着、标题不压系统按钮；失焦时该窗口的顶栏
   一起变灰；macOS 上红绿灯不被内容压住；查看器全屏时栏的显示符合第 7 节的决定。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 420px 级弹窗要不要也自绘 | 暂不：它们本来就小，先只统一查看器与现有弹窗的规格 |
| 2 | 查看器的栏高与全屏行为 | 栏高 36；全屏时隐藏标题栏 |
| 3 | 公共件放 `components/` 还是 `components/layout/` | `components/`（眼下只有一个组件） |
