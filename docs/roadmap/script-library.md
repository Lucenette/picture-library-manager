# 脚本库：互相引用、外部依赖与补全跳转

**状态**：待评审
**关联**：[script-management.md](../design/script-management.md)（脚本正文落盘、草稿与分组）、[SCRIPTING.md](../SCRIPTING.md)（脚本 API 与 `require` 的既有说明）

---

## 1. 背景

1. **运行时其实已经能互相调用**：脚本编译用的是真正的 Node `Module._compile`，并且把脚本自己的绝对路径传了进去（`src/main/script/compile.ts:34`），所以 `require('./helper')` 按**脚本所在目录**解析——`docs/SCRIPTING.md:202` 已把它写成承诺，紧接着 207 行写明「脚本没有沙箱，可 `require` 任意 Node 模块、读写任意文件」。缺的不是能力，是**组织方式**与**引用体验**。
2. **拖进编辑区拿到的是无意义的文本**：侧栏拖拽只设了一个 `text/plain` 载荷（`ScriptSideList.vue:314`，给「拖进分组改归属」用），而 `MonacoEditor.vue` 没有任何 `drop` 处理，于是走浏览器默认行为，把这段条目 key 插到光标处——既不是路径也不是名字。
3. **库脚本改了不生效**：被 `require` 的模块进 Node 自己的模块缓存，之后不再读盘；而应用每次调用只重读**主脚本**（`src/main/script/files.ts:59` 按 mtime + 大小缓存）。两者叠起来会打破「改了脚本下一次调用就生效」这条既有承诺——这是任何「库」方案都必须先解决的。
4. **第三方库没有可靠落点**：`compile.ts:36` 把模块查找路径设成 `_nodeModulePaths(process.cwd())`，开发态碰巧能 `require` 到应用自己的依赖，打包后进程的 CWD 不确定（Linux 从 `.desktop` 启动时可能是 `/`），基本不可用。
5. **补全与跳转的地基已经在**：`monaco-env.ts:71` 已经在用 `addExtraLib` 给语言服务喂 CJS 全局声明，JS 语言服务在进脚本页时预热（`warmUpTypeScript()`）；缺的是「API 声明 + 把用户脚本注册成虚拟文件」。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-09-29 | 首次记录（需求登记 + 可行性分档） | 使用者提出 |

---

## 2. 目标与非目标

**目标**

1. 库脚本可以被其它脚本引用，且引用**不随显示名或文件名的变动而失效**。
2. 从侧栏把脚本拖进编辑区，得到一行可直接用的引用（就像把控件拖进脚本拿到对象）。
3. 补全与 F12 跳转覆盖两件事：框架 API（`identify-structure` / `identify-character` / `select-image` 的入参与返回）与其它脚本的导出。
4. 库脚本改了，**下一次调用就生效**，不牺牲现有承诺。
5. 用户自带的第三方**纯 JS** 库有明确的放置位置与解析规则。

**非目标**

- 不做包管理器：不解析依赖树、不锁版本、不做 `npm install` 客户端；
- 运行时不做类型检查（类型检查交给编辑器的语言服务）；
- 不支持原生模块（N-API / 预编译二进制，ABI 与 Electron 不匹配）与 ESM-only 包；
- 不支持动态 `require`（变量拼出来的标识符）；
- 不承诺能 `require` 到应用自己的依赖（打包与 asar 下都不可靠）。

## 3. 设计

### 3.1 模块身份与自定义 `require`

- 磁盘文件名是 `<uuid>.js`（`files.ts:30`），不能直接当引用名用。引入**应用内模块名**：`require('plmanager:script/<显示名>')`，由自定义 `require` 解析——在 `_compile` 之前替换掉 `scriptModule.require`，并让整棵依赖树都用同一个实现。
- 解析按**脚本 id**（不是名字）落到文件，所以显示名重命名不会断引用；同一分组内显示名唯一（沿用现有约束），跨分组重名时按「分组 / 名字」补全前缀。
- 相对路径 `require('./helper')` 保持今天的行为（按脚本文件所在目录解析），两种写法共存。

### 3.2 缓存与「改完即生效」

- 自定义 `require` 自己维护缓存，键是**解析后的绝对路径**，值里存 `mtime + size + exports`；每次取用先比对 stat 结果，变了就重编译这一条（复用 `readScriptSource` 的判据）。
- 主脚本仍然每次都重读重编译（现有行为），变化只在「它引用的东西」上。

### 3.3 依赖图异步预读（主进程不许同步 IO）

- `require` 是同步 API，而主进程的硬性约定是 I/O 一律异步。做法：编译前先用**字面量扫描**（正则即可，只认 `require('...')` 与 `import ... from '...'`）收集直接依赖，异步读完整棵依赖树，再用内存 `require` 同步地编译——磁盘 IO 全部发生在异步阶段。
- 循环依赖：内存 `require` 先登记占位导出再回填，与 Node `Module._cache` 的可见行为对齐；`module.parent` / `require.main` 这类边角不承诺。
- 扫不到的动态 `require` 明确不支持，文档写清（必要时编译期给一条警告）。

### 3.4 第三方库的落点与解析规则

- **解析规则**：裸标识符按 Node 的默认算法解析，但**根是脚本目录**——`Module._nodeModulePaths(dirname(脚本路径))`。于是 `<用户目录>/scripts/node_modules/` 成为用户自己的依赖目录，与 Node 习惯一致。
- **怎么放进去**：先只支持「用户自己放」——会 Node 的可以 `cd scripts && npm install <包>`；不会的可以把打包好的单文件 UMD `.js` 丢进 `scripts/lib/`。两者都靠上面同一条解析规则。
- **限制**（必须写进 [SCRIPTING.md](../SCRIPTING.md)）：只支持纯 JS；原生模块（含 `sharp` 这类预编译二进制）用不了；ESM-only 的包可能 `require` 不了；安装脚本（`postinstall` 之类）不由我们执行。
- **安全声明**：脚本没有沙箱、跑在主进程、与应用同权限——引入第三方库等于把那段代码请进应用进程。界面与文档都要直说，且不做「自动安装」这类主动引入代码的入口（见待决 3）。

### 3.5 拖拽插入引用

- 侧栏 `dragstart` 增加一个**专用 MIME**（如 `application/x-plmanager-script`）承载结构化载荷（脚本 id / 显示名），`text/plain` 保留给现有的分组拖动。
- 编辑器侧只处理这个 MIME：在光标处插入 `const <建议变量名> = require('plmanager:script/<显示名>');`；没有这个 MIME 的拖放不拦截，原有行为不变。

### 3.6 补全与跳转

- **API 声明**：一份 `.d.ts`（三个脚本类型的入参与返回），用 `addExtraLib` 喂给语言服务——这条通道今天已经在用（`monaco-env.ts:71`）。
- **脚本注册成虚拟文件**：每个脚本一条 model 或 extra lib，路径形如 `file:///…/scripts/<显示名>.js`，这样 `require('plmanager:script/<显示名>')` 有补全、F12 能找到定义。要先给自定义模块名做一条 TS 的**模块声明映射**（`declare module 'plmanager:script/*'`），否则语言服务不认这个前缀。
- 语义报错目前被有意关掉（`noSemanticValidation`，避免 `require('sharp')` 这类假错）；补全与跳转不受影响。库脚本是 JS，成员补全靠语言服务对 `module.exports` 的推断，复杂库会退化成 `any`——鼓励库脚本写 JSDoc 即可改善，不必手写 `.d.ts`。

### 3.7 TypeScript 脚本（若做）

- **运行时只做转译，不做类型检查**：`typescript.transpileModule()` 是纯 JS、无原生依赖，当前是 devDependency，需要进运行时（或以打包方式进主进程 bundle）。另一条路是用 Electron 自带 Node 的类型剥离，但要先实测 `process.versions.node`，且只支持可擦除语法（无 `enum` / `namespace` / 参数属性）。
- **编辑器侧**：现在刻意只配了 `javascriptDefaults`（`monaco-env.ts:53` 的注释），做 TS 要补 `typescriptDefaults`（同一份 CJS 全局与 API 声明各喂一份），并按扩展名给模型选语言。
- 文件与解析：`.ts` 与 `.js` 共存，相对 `require` 按 `.ts` → `.js` 顺序试扩展名；内置默认脚本保持 JS（`src/static/default-script.js` 的语义不动）。
- 结论：**不难**，成本在「两种文件共存 + Monaco 两侧配置 + 错误怎么呈现」，不在「能不能跑」。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/main/script/loader.ts` | 内存 `require`：模块名解析、依赖图预读、mtime 失效、循环依赖 |
| `src/main/script/compile.ts` | `_compile` 前换掉 `require`；查找路径的根从 `process.cwd()` 改成脚本目录 |
| `src/main/script/files.ts` | 相对引用的扩展名解析（`.ts` / `.js`）、库目录约定 |
| `src/common/ipcChannels.ts` | 新通道：读脚本导出摘要（若语言服务方案不够用） |
| `src/renderer/views/main/scripts/ScriptSideList.vue` | `dragstart` 增加专用 MIME 载荷 |
| `src/renderer/views/main/scripts/MonacoEditor.vue` | 处理专用 MIME 的 `drop`；按扩展名选语言 |
| `src/renderer/views/main/scripts/monaco-env.ts` | API 声明 + 自定义模块名映射 + 把脚本注册成虚拟文件（+ TS 支持时的 `typescriptDefaults`） |
| `docs/SCRIPTING.md` | 新增三节：库脚本与互相引用、第三方依赖与限制、TypeScript |

目录与文件按 [AGENTS.md](../../AGENTS.md) 的「动手前先给方案」走，上面的表就是方案。

## 5. 风险

| 风险 | 应对 |
|---|---|
| 安全：装第三方库 = 任意代码在主进程执行 | 文档与界面写明；不做自动安装入口，只支持「用户自己放」 |
| 缓存失效做漏 → 库改了不生效，使用者会认为功能坏了 | 单测覆盖「改内容 / 改 mtime / 删文件」三种情况 |
| 内存 `require` 与 Node 语义有偏差（循环依赖、`module.parent`、`require.cache`） | 只承诺最小集合，差异写进文档 |
| 虚拟工程喂给 Monaco 的脚本变多 → 内存与进页开销上升 | 只喂「被引用的库脚本 + 当前打开的那一份」，按需增量添加 |
| 同步 `require` 与「主进程不许同步 IO」的约定冲突 | 依赖图异步预读，编译阶段只走内存 |
| Windows 路径大小写 / 分隔符与 TS 的 URI 映射不一致 | 统一小写盘符 + 正斜杠后再映射成 `file://` URI |

## 6. 验证方法

1. 纯逻辑：模块名解析、字面量依赖收集、mtime 失效判定——用临时目录在沙箱里跑断言（不需要 Electron）。
2. 人工冒烟：拖拽插入引用、补全出现库脚本导出、F12 跳到库脚本、改库脚本后下一次调用生效、删库脚本后错误可见。
3. 边界：确认 `scripts/node_modules` 之外解析不到（`require` 不到应用自己的依赖），并在文档里写明这条是有意的。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 模块身份：应用内名字还是按显示名落盘 | 应用内名字（`plmanager:script/<显示名>`），重命名不断引用 |
| 2 | 第三方库放 `scripts/node_modules/` 还是 `scripts/lib/` | `node_modules`（与 Node 习惯一致，用户可自己 `npm install`） |
| 3 | 要不要做「安装库」界面（从 registry 下载 tarball 解包） | 先不做，单列一条路线图再议 |
| 4 | TypeScript 与这条例一起做，还是单列 | 单列（运行时转译 + Monaco 两侧配置是独立决策） |
| 5 | 库脚本的导出摘要谁来算 | 让语言服务直接看正文（虚拟文件），不自己写解析器 |
