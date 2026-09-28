# 颜色主题切换

**状态**：待评审
**关联**：[settings-page.md](./settings-page.md)（主题是它的第一个设置项，值存在 `settings.yml`）

---

## 1. 背景

1. **现在只有深色一种，而且深色是硬编码散在 18 个文件里**：`src/renderer/styles/theme.css` 38 处（`:root` 里直接就是深色调色板，第 5 行起）、`src/main/window-manager.ts` 14 处（窗口底色 `#1e1f22`、标题栏 `#26282c`、系统按钮字形色 `SYMBOL_COLOR_ACTIVE` / `SYMBOL_COLOR_INACTIVE`）、`App.vue` 6 处、`scripts/monaco-env.ts` 5 处、`scripts/ScriptSideList.vue` 5 处，其余是各对话框与查看器（查看器底色 `#0d0d0d`）。
2. **首帧颜色由主进程带进渲染进程**：`entries/shell/first-paint.ts` 用窗口 URL 上的 `?bg=` 内联设置 `--win-bg`。所以主题不能在页面挂载后才决定，否则会先闪一下错误的底色。
3. **窗口那一层也归主进程**：`BrowserWindow` 的 `backgroundColor` 与 Windows / Linux 的 `titleBarOverlay.symbolColor` 都在主进程设（`window-manager.ts:17,112,120`），渲染进程改不了——它和「失焦压暗」是同一套机制（现成的 `syncSymbolColor` 就是改字形色的例子）。
4. **Element Plus 只引了 `element-plus/dist/index.css`**（`entries/shell/element-plus.ts:4`），没有引 dark css-vars——说明现在的深色是我们自己在 `:root` 覆盖变量做的，不是 EP 的深色模式。这条决定了做法：要把「深色写在根上」反转为「两套主题各一套变量」。
5. **小入口各有独立底色**：查看器、浮窗、对话框都是独立入口与独立样式（`entries/` 四份），主题必须在**每个入口**都生效，不能只改主窗口。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-29 | 首次记录（需求登记） | 使用者提出 |

---

## 2. 目标与非目标

**目标**

1. 深色 / 浅色 / 跟随系统三种选择，值写在 `settings.yml` 的 `theme` 键里。
2. 切换后**立即生效**：所有已开窗口（含查看器、浮窗、对话框）的底色、文字、边框、标题栏与系统按钮字形色一起换，不重启、不闪错色。
3. 颜色只有一个来源：调色板收敛成主题变量，页面与组件里不再写字面色值。

**非目标**

- 不做任意自定义配色（选主色、自建主题）；
- 不做主题导入导出与主题市场；
- 不改 Element Plus 组件自身的行为，只换变量。

## 3. 设计

### 3.1 调色板收敛到一个地方

- `styles/theme.css` 现在 `:root` 直接写深色；改成两个块：`html.theme-dark` 与 `html.theme-light`，各自给出同一批变量（Element Plus 的 `--el-*` 覆盖 + 我们自己的 `--app-*`：标题栏、导航栏、编辑器底色、查看器底色）。
- 主进程侧也放一份**小映射**（窗口底色 + 两对系统按钮字形色），因为窗口创建与 `setTitleBarOverlay` 都在主进程。
- 把散在 18 个文件里的字面色值逐个收进这两块——这是本次改动量的主体，也是浅色能干净落地的前提。

### 3.2 首帧与跟随系统

- 主题由主进程决定（`settings.yml` 的 `theme`，`system` 时取 `nativeTheme.shouldUseDarkColors`），作为查询参数随窗口 URL 带进去——与现在的 `?bg=` 同一处（`window-manager.ts` 的 `getWindowUrl`）。`first-paint.ts` 的内联脚本按它给 `<html>` 加 `theme-dark` / `theme-light` 并把 `--win-bg` 设对，**首帧之前**就定下来。
- 跟随系统时监听 `nativeTheme.on('updated')`，主进程广播给所有窗口；只在真的变化时广播，不做轮询。
- 渲染进程可用 `localStorage` 做一次「避免闪」的快速路径，但**权威值永远是主进程参数 + `settings.yml`**。

### 3.3 主进程那一层同步改

- 切换时对每个已开窗口：`setBackgroundColor()` + `setTitleBarOverlay()`（字形色用浅色那一对），并把新底色缓存进窗口管理器，供之后新建的窗口使用。
- 浮窗与查看器窗口有各自的默认底色配置（`window-manager.ts` 里逐个 `createXxx()`），一并从映射里取。

### 3.4 Monaco

- `monaco-env.ts:40` 的 `defineTheme('plmanager-dark', base 'vs-dark')` 写死一个；改成一对（`plmanager-dark` / `plmanager-light`，后者 `base: 'vs'`），主题变化时 `monaco.editor.setTheme(...)`。

### 3.5 各入口统一应用

- `entries/shell/window-chrome.ts` 已经是四个入口共用的初始化点（平台类 + 失焦标记），主题类也挂在这里：各入口在首帧脚本之后、挂载之前保证 `<html>` 上已有正确的主题类。

### 3.6 持久化

- 主题存 `settings.yml`（`settings-page.md` 的第一个设置项），不单独存在 `localStorage`；`localStorage` 只作首帧快速路径。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| `src/renderer/styles/theme.css` | 拆成两套变量并收编散落色值 |
| `src/main/window-manager.ts` | URL 带主题、窗口底色与字形色跟随、`nativeTheme` 监听、底色映射 |
| `src/main/settings/*`（见 settings-page） | `theme` 键：`dark` / `light` / `system` |
| `src/renderer/entries/shell/first-paint.ts` | 按参数在首帧前加主题类 |
| `src/renderer/entries/shell/window-chrome.ts` | 各入口统一的主题应用点 |
| `src/renderer/views/main/scripts/monaco-env.ts` | 一对 Monaco 主题 + `setTheme` |
| 各 `.vue`（App、查看器、对话框、浮窗、脚本页） | 去掉字面色值，改用变量 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 散落的字面色值漏改，浅色下出现深色块 | 全仓搜索十六进制色值逐个过；浅色下每个窗口人眼走一遍 |
| 首帧闪错色 | 主题随 URL 传入 + 内联脚本先加类；`localStorage` 只作兜底 |
| 系统按钮字形色在浅色下看不清 | 浅色一套独立字形色；Windows / Linux 上实际点一遍 |
| 跟随系统时频繁切换 | 只在 `nativeTheme` 真的变化时广播 |
| 第三方组件在浅色下的对比度不足 | 只换变量不动组件；浅色下逐页检查 |

## 6. 验证方法

1. 静态：全仓搜索十六进制色值，应当只剩主题定义与主进程那份映射；其余命中逐个确认。
2. 人工冒烟：三种模式各切换一次，确认所有已开窗口立即跟上、重启不闪、跟随系统时改系统主题能跟。
3. 平台：Windows / Linux 看系统按钮字形色（WCO），macOS 看红绿灯与标题栏的对比度。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 浅色是否就用「Element Plus 默认 + 我们的品牌主色」 | 是，减少自己维护的变量 |
| 2 | 跟随系统第一版就做还是第二步 | 第一版就做（`nativeTheme` 很直接） |
| 3 | 主进程那份底色映射放哪 | 放窗口管理器旁边的小表，和主题变量一一对应 |
| 4 | 图片查看器要不要独立配色 | 不独立，跟全局；图片区域保持中性灰 |
