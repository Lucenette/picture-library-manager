# 编辑器语法分析器换成 TextMate

**状态**：现行架构
**最后更新**：2026-10-08

**关联**：[theme.md](./theme.md)（按作用域配色的落点）

---

## 1. 背景

1. 脚本编辑器原先用 Monaco 内置分词器：`//` 与 `/* */` 都归成同一个 `comment` 词元，只有 `/** */` 是独立的 `comment.doc`。
2. 于是主题里注释最多只能配两级，`Dark.icls` / `Light.icls` 里本来就有的「行内注释灰、行间注释绿」表达不出来。
3. Monaco 的 `rules` 只能按分词器给出的词元名着色：不换词法层，配色就到此为止。
4. 换成能给出作用域的词法器之后，关键字、字符串、模板串、类型、参数都能分开配，粒度由作用域决定。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-06 | 首次定稿 | — |
| 2026-10-08 | 核现状后修订并落地：wasm 改用 `?url&inline` 内联，首版只做 `javascript` | `file://` 页面 + `webSecurity` 下运行时取不到本地 wasm；脚本只有 `.js`，没有 `typescript` model |
| 2026-10-08 | 色值改按 WebStorm 导出的配色方案逐作用域对齐 | 使用者导出 `dist/webstorm-themes`，有了可核对的来源 |

---

## 2. 边界

- 只管**词法**：把一行文本切成带作用域的片段交给主题取色。分词结果只影响颜色与折叠等纯语法特性。
- 只覆盖 `javascript`：`json` / `css` / `markdown` 等继续用内置分词器；再接 `typescript` 要等脚本库支持 `.ts`（见 [script-library.md](../roadmap/script-library.md)）。
- 不动编辑器其它能力：补全、诊断、格式化与语义高亮都不经过这一层。

## 3. 不变量

1. **词法器必须先于任何 `javascript` model 设好。** Monaco 内置的 JavaScript 分词器是一个惰性工厂
   （`registerTokensProviderFactory`）：模型第一次要词法时才创建并注册，工厂晚于我们跑完就会把我们盖掉。
   预热与编辑器都先 `await initTextMate()`。
2. `comment.line.*` 与 `comment.block.*` 必须落到不同颜色，两套主题各一份。
3. **通用词元名规则不能删**：`comment` / `keyword` / `string` / `number` / `constant` / `function` / `type` /
   `operator` / `delimiter` / `invalid` 既是失败降级时的着色，也是 TS 语义高亮的取色来源（语义 token 匹配的也是同一张表）。
4. 渲染进程不引 Node 内置模块；不在运行时 fetch 本地文件；不为它新增构建开关。

## 4. 失败策略

| 情形 | 行为 |
|---|---|
| wasm 解码 / 实例化失败、语法编译失败、初始化超时（10s） | `log.error`（`renderer.textmate`）→ 初始化以 `{ ok: false, reason }` 结束，**不 reject** |
| 判定失败后进脚本页 | 照常建编辑器（走回内置分词器），编辑区上方一条常驻提示写明原因，**不静默退回** |
| 主题切换 / 切脚本 / 卸载组件 | 不受影响；`setTokensProvider` 只设一次 |

失败不废掉编辑器：脚本页不白屏是底线，而「可见的降级」已经满足「不悄悄退回」。

## 5. 装配路径

```
javascript.tmLanguage.json（VS Code，MIT，?raw）
        │
onig.wasm（vscode-oniguruma，?url&inline → base64 data URL）──► 解回字节 ──► loadWASM
        │
vscode-textmate 的 Registry ── loadGrammar('source.js') ──► 逐行给出作用域
        │
adapter：只取最具体的一段作用域 ──► monaco.languages.setTokensProvider('javascript', …)
        │
主题 rules：{ token: 'comment.line' / 'comment.block' / …, foreground: … }
```

**机制只有一处**：`src/renderer/views/main/scripts/textmate/`；预热与编辑器只写「等就绪 / 画加载态 / 画降级提示」，
主题只在 `src/common/theme/` 改数据。

`adapter.ts` 是不依赖 wasm 与 Monaco 运行时的纯适配层（只 `import type`），所以能在普通 Node 测试里驱动。

### 5.1 为什么 wasm 要内联

打包后渲染进程是 `file://` 页面，而 `webSecurity = app.isPackaged`（生产为真），运行时 `fetch(file://…)` 取不到本地文件。
所以让 Vite 的 `?url&inline` 把 `onig.wasm` 内联成 base64 data URL，再由适配层解回字节。
`.wasm` 不能直接用 `?inline`：Vite 默认的 `assetsInclude` 不含 `wasm`，必须借 `?url` 过闸、让 `inline` 生效。

## 6. 作用域到颜色

主题是一棵按 `.` 分段的 trie（`themeTrieElement.match`），规则 token 按点分前缀匹配，于是：

- 通用词元名规则靠前缀自动命中同族作用域（`string` 命中 `string.quoted.double.js`）。
- 适配层从最内层往外找第一段带颜色家族的作用域，跳过 `punctuation.*` 与 `meta.*`：注释的 `/**` 是
  `punctuation.definition.comment.js`、字符串的引号是 `punctuation.definition.string.begin.js`，它们都该跟外层同色，
  而不是命中一条 punctuation 规则变成底色。结构性作用域因此不在主题里单独配（没有 `punctuation` / `meta.brace` 规则）。
- JSS 把 `let` / `const` / `function` 归 `storage.*`，类型归 `entity.name.*` 与 `support.*`；这些不以通用词元名开头，必须单独给。
- 色值取自 WebStorm 导出的配色方案：暗色是 Islands Dark（`editor/Islands-Dark.json`），浅色是 Light（`editor/Light.json`，Islands Light UI 声明的编辑器方案）。规则里行尾写着对应的 JetBrains 属性名，改色对着导出文件核。
- `comment.line` 与 `comment.block` 在 Islands Dark 里同为灰、只有 `comment.block.documentation` 是绿；Light 方案三者同灰——这是方案本身的选择，不是漏配。方案没给值的属性（如浅色的 `DEFAULT_CLASS_REFERENCE`）落到 `editor.foreground`。

## 7. 机械守卫

| 不变量 | 守卫 |
|---|---|
| 作用域取值与状态协议 | `test/renderer/views/main/scripts/textmate/adapter.test.ts`（纯逻辑，假分词器） |
| 语法真能把行内 / 行间注释分成两族 | `test/renderer/views/main/scripts/textmate/grammar.test.ts`（真 wasm + 真语法，Node 里跑） |
| 两套主题分开配且通用规则没被删 | `test/main/theme.test.ts` 的「Monaco 的语法着色规则」 |
| 打包后取得到 wasm | 机械上只能验产物形态；真实加载靠人工冒烟（见第 9 节） |

## 8. 已知代价

| 取舍 | 代价 |
|---|---|
| 语法与 wasm 内联进脚本页 chunk | 多约 0.9 MB（语法 227 KB + wasm base64 约 631 KB）；换来的是 `file://` 页面里同样取得到 wasm |
| 分词在主线程逐行跑 | 与原来的 Monarch 同为同步主线程实现，不是新增的线程模型 |
| 首版只做 `javascript` | 脚本库支持 `.ts` 时要再 vendor 一份 `source.ts` 并注册 `typescript` |

## 9. 改动后怎么验

- 规则与作用域：`yarn test`（上面三个用例文件）。
- 构建产物：构建后确认 `out/renderer` 下没有独立的 `.wasm`、chunk 里有 `data:application/wasm;base64`。
- 人工冒烟：`yarn dev` 与 `yarn preview` 下进脚本管理页——行内 / 行间注释不同色、字符串 / 关键字 / 数字取色正常、
  TS 语义高亮仍在、切系统明暗跟着变。
