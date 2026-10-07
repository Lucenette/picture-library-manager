# 图标库

**状态**：现行架构
**最后更新**：2026-10-07

**关联**：[theme.md](./theme.md)（图标的颜色与尺寸都跟主题令牌走）

---

## 1. 背景

1. **图标来源绑死在 Element Plus 上。** 界面图标全部来自 `@element-plus/icons-vue`，它只为 EP 组件设计，
   集合小、风格固定在 EP 那一套；想加一个常用图标就得自己画或再引一套。
2. **两套图标混用会不一致。** 临时补图标只能写字面 SVG 或另引一个库，线与圆角风格对不上，同一页出现两种观感。
3. **需要一个能跟主题、又能按需打包的方案。** 图标要跟 `--app-*` 令牌变色（`currentColor`），
   且只把用到的打进包——EP 图标包整体不小，全量引入不值。
4. **原来没有图标的统一入口。** 组件各自 `import { Xxx } from '@element-plus/icons-vue'`，换库要满仓改。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-07 | 首次定稿 | 审查遗留登记「替换 EP 图标库」，排在本版（1.1.2）完成 |
| 2026-10-07 | 落地并迁入 `docs/design/`：`unplugin-icons` + Lucide、语义名映射与 `AppIcon`、ESLint 守卫 | 方案实施完成 |

---

## 2. 结构与机制

- **来源**：`unplugin-icons` + `@iconify-json/lucide`（都是 devDependency）。`~icons/lucide/<名>` 在**编译期**
  产出一个 SVG 组件，只把引用到的图标打进产物，没有运行时图标库依赖。
- **唯一入口分两层**，各管一件事：

  | 位置 | 职责 |
  |---|---|
  | `src/renderer/components/icons.ts` | 语义名 → 图标组件的映射 `ICONS` 与类型 `IconName`；**`~icons/*` 只允许出现在这里** |
  | `src/renderer/components/AppIcon.vue` | `<AppIcon name="plus" />`：按语义名渲染，不加包裹元素、不写尺寸与颜色 |

- **尺寸与颜色不在这里定**：图标是 `1em` 的 SVG、颜色走 `currentColor`，所以尺寸跟所在位置的
  `font-size`（外层是 `el-icon` 时就是它的 `size`）、颜色跟 `color`。组件里不出现尺寸与色值。
- **要组件而不是标签的位置**（`el-button` 的 `:icon`）用 `ICONS.<语义名>`，仍然过同一张表。

## 3. 加一个图标 / 换一处图标

1. 在 `ICONS` 里加一条 `<语义名>: IconXxx`（导入 `~icons/lucide/<名>`）。
2. 用它的地方写 `<AppIcon name="语义名" />` 或 `:icon="ICONS.语义名"`。
3. 换图标集 = 改 `icons.ts` 的导入与 `electron.vite.config.ts` 里 `Icons()` 的集合；换某一个图标 = 改映射里的一行。
   两种改动都不进组件。

## 4. 改动时的检查点

- **`~icons/*` 只准出现在 `components/icons.ts`**，`@element-plus/icons-vue` 全仓禁用——两条都由
  `eslint.config.mjs` 的 `no-restricted-imports` 拦。注意 EP 图标包**仍在依赖树里**（`element-plus` 自己要它），
  所以「搜不到引用」与「装不装这个包」是两件事。
- **`AppIcon` 不许加包裹元素。** 图标本身就是 `1em` 的 SVG，套一层会在「外层类也带布局属性」的位置上打架
  （平铺视图的 `.tile-cover-empty` 就是这种：它带 `inset: 0` 与 `display: flex`），也会改掉 `el-icon` 定下的对齐方式。
- **`~icons/*` 的模块声明来自 `tsconfig.web.json` 的 `types` 里的 `unplugin-icons/types/vue`**：删了它
  `vue-tsc` 会报找不到模块，而 `tsc` 看不见 `.vue`，漏掉的正是这一步。
- 加图标时**逐处核对语义**，别为了少一条映射让两个语义共用一个名字：`ICONS` 每条都注明了用在哪，
  名字对不上时宁可加一条。

## 5. 已知取舍

| 取舍 | 代价 |
|---|---|
| 引用编译期插件 | 构建配置多一个插件、`tsconfig.web.json` 多一条 `types`；换来零运行时依赖与按需产物 |
| 全仓只用一套线条风格（Lucide） | 个别位置的图标只能取近似（图组管理用 `layout-grid`、没有封面用 `image`）；不混第二套风格 |
| 语义名映射，而不是在各处直接写图标名 | 多一层间接；换来换库、核对风格、封禁直接引用都只改一处 |
