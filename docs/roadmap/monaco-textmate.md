# 编辑器语法分析器换成 TextMate

**状态**：待实施
**关联**：[theme.md](./theme.md)（按作用域配色的落点）

---

## 1. 背景

1. 脚本编辑器用 Monaco 内置分词器：`//` 与 `/* */` **都归成同一个 `comment` 词元**，只有 `/** */` 是独立的 `comment.doc`。
2. 于是主题里注释最多只能配两级——`Dark.icls` / `Light.icls` 里本来就有的"行内注释灰、行间注释绿"表达不出来。
3. Monaco 的 `rules` 只能按**分词器给出的词元名**着色：不换词法层，配色就到此为止。
4. 换成能给出**作用域**的词法器之后，关键字、字符串、模板串、类型、参数都能分开配，粒度由作用域决定。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-05 | 首次定稿 | — |

---

## 2. 目标与非目标

**目标**

1. 脚本编辑器（TypeScript / JavaScript）改用 TextMate 作用域，`comment.line` 与 `comment.block` 能分开着色。
2. 主题的 `monaco.rules` 由词元名改成作用域，两套颜色按同一套作用域配置。
3. 现有行为不回退：脚本页不白屏，TS worker 的语义高亮（变量 / 函数 / 参数）仍在。

**非目标**

- 首版不覆盖 TS/JS 以外的语言（`json` / `css` / `markdown` 保持内置分词器）。
- 不动编辑器以外的能力（补全、诊断、格式化）。

## 3. 设计

### 3.1 装配路径

```
语法文件（.tmLanguage.json，取自 VS Code，MIT）
        │  ?raw / ?json 导入
        ▼
vscode-oniguruma（onig.wasm，用 ?url + fetch 取 ArrayBuffer）
        │  初始化（异步）
        ▼
vscode-textmate 的 Registry ── loadGrammar ──► 能给出作用域的分词器
        │
        ▼
monaco.languages.setTokensProvider(...)        顶掉内置分词器
        │
        ▼
主题 rules：{ token: 'comment.line', foreground: … }
```

### 3.2 三条约束

1. **二选一**：`setTokensProvider` 之后内置词元名（`comment` / `comment.doc` …）不再出现，主题规则必须整体改成作用域——这正是"更精细着色"的落点。
2. **WASM 不能引 Node**：用 Vite 的 `?url` 资源导入 + `fetch` 拿 `ArrayBuffer`，符合"渲染进程不引 Node 内置模块"的红线。
3. **异步初始化不许静默退回**：脚本页要有加载态；初始化失败要写日志并在界面可见，不允许悄悄用回内置分词器。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| `package.json` | 加 `vscode-textmate` 与 `vscode-oniguruma`（**需使用者批准后再执行**） |
| **新增** 语法文件目录 | 放 `typescript.tmLanguage.json`（VS Code，MIT） |
| `src/renderer/views/main/scripts/` | 新增 TextMate 装配模块，在编辑器创建前完成初始化 |
| `src/common/theme/dark.ts` / `light.ts` | `monaco.rules` 由词元名改为作用域 |
| `docs/design/`（落地后） | 迁移本文，补上作用域清单与例外 |

## 5. 风险

| 风险 | 应对 |
|---|---|
| 打包后 `onig.wasm` 取不到（本项目已开 `asar`） | 用 Vite 产物路径而不是源码路径，`yarn preview` 里实测一次 |
| 初始化异步，存在"词法器还没好"的窗口期 | 脚本页出加载态，编辑器等就绪后再建 |
| 体积增加（WASM 约 0.5 MB） | 接受；若在意，后续再评估按需加载 |
| 换分词器影响编辑器内**所有**语言 | 首版只给 TS/JS 注册，其余语言继续用内置分词器 |

## 6. 验证方法

1. 脚本侧：装配依赖 WASM 与浏览器环境，纯 Node 里跑不了；可测的是"作用域 → 颜色"的映射（抽成纯数据后补用例）。
2. 人工冒烟：`yarn dev` → 脚本管理页，行内注释与行间注释**不同色**，字符串 / 关键字 / 数字 / 函数取值与两套 `.icls` 一致，切系统明暗后着色跟着变；`yarn preview` 里再验一次 WASM 能加载。
3. 静态自检照旧：`tsc` / `vue-tsc` / `lint` / `test` / `check-docs`。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 除 TS/JS 外还接哪些语言 | 先只做 TS/JS，用起来再扩 |
| 2 | 是否直接由 IDEA 的 TextMate 主题转换，省掉手工作用域映射 | 先手工映射（规则少、可控），转换留给以后 |
