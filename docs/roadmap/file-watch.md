# 文件读写与变更监听（fs 层）

**状态**：待实施
**关联**：[open-script-in-editor.md](./open-script-in-editor.md)（它原非目标里的「外部改动自动跟着变」由本文件接管）、[settings-page.md](./settings-page.md)（设置文件的热加载挂在那份文件上）、[../design/script-management.md](../design/script-management.md)（脚本正文、草稿与类型关联的不变量）

---

## 1. 背景

1. **文件读写不统一**：统一的只有路径（`paths.ts`）与日志通道，读写散在 7 个主进程文件里各写各的——`script/files.ts`（12 处调用）、`settings/store.ts`（2 处，写却借 `@/script/files` 的 `writeFileAtomic`）、`ups/engine.ts`（4 处）、`log/logger.ts`（4 处）、`database/db.ts`、`task/runners/export.ts`、`image/walk.ts`。由此长出三套重复：两套原子写、三处「目录读不出来就当空」、快照逻辑私有在脚本模块里。
2. **其中三处是同步 I/O**（违反 AGENTS 运行时约定第 2 条）：`database/db.ts:170` 的 `copyFileSync` 把**整个库复制成 `.bak`**——开发库实测 103 MB、节流到 30 秒一次，且从写库路径直接调用；`task/runners/export.ts:25,55` 的 `mkdirSync` 与 `copyFileSync` 落在导出目标上（常常是网络盘）；`image/walk.ts:64,77,103,116` 的 `readdirSync` / `statSync` 在遍历图库时逐条同步调用——它正是 AGENTS 拿来讲「分片让出」的那个文件，但每次调用本身仍是同步的。
3. **全仓没有任何文件监听**：`fs.watch` / `watchFile` / `chokidar` 零命中。于是两件事做不到：手改 `settings.yml` 保存后要重启才生效（`settings/store.ts` 只在启动读一次）；外部改脚本后内置编辑器显示的仍是旧正文。
4. **脚本的「生效」只成立一半**：运行路径已经每次调用重新读盘并重新编译（`readScriptSource` 按路径 + mtime + 大小缓存），所以外部保存后下一次扫描/选图就会用新内容；但**类型关联只在「内容来自磁盘」时刷新**（打开那份脚本才会），而扫描的前端是按库里存的类型筛脚本的（`listScriptsByType`），于是外部改了导出函数，候选列表会一直用旧类型。
5. **模块引用还有三处 `require`**：`script/compile.ts:24`（`require('module')`）、`image/thumbnail-sharp.ts:84`（`require('sharp')`）、`image/walk.ts:20`（`require('image-size/fromFile')`），靠 ESLint 的一个三文件例外块放行。其中 `thumbnail-sharp.ts` 为了「拿不到类型」手写了五个结构接口，并为「sharp 可能缺失」造了一条完整的失败路径（`sharpFactory` / `loadError` / `requireSharp()`）——sharp 是显式依赖，装不上时 `yarn install` 就报错了，那条路径不可达。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-07 | 首次定稿 | 需求：手改设置与外部改脚本都要「保存即生效」；评审后定为**统一收口成一层**，而不是两个各写一半的实现 |

---

## 2. 目标与非目标

**目标**

1. 应用自己管的文件只有**一个**读写与监听的落点：`src/main/fs/`，业务模块只从 `@/fs` 取能力。
2. 手改 `settings.yml` 保存后**立即生效**（含主题、窗口配色与设置页显示），不需要重启；半截文件或坏值不改变当前内存态。
3. 外部改脚本后：**类型关联立即刷新**并推给界面；内置编辑器里的正文在**窗口重新获得焦点**时按「不脏就静默重载、脏就弹原生确认框」处理。
4. 模块引用一律是**文件顶部的静态 import**；`require` 与动态 `import()` 由 ESLint 机械拦住（唯一天然的动态加载是用户脚本，走 `Module._compile`，不算模块引用）。
5. 收口时把上述三处同步 I/O 一并改成异步。

**非目标**

- 不监听图库来源目录（两万多文件、且会立刻引出「自动重扫」的任务语义）；
- 不做声明式「资源定义」框架（本仓的形状是机制统一、策略本地）；
- 不处理 `scripts/` 里不属于任何脚本行的孤儿 `.js`（层会把变化路径交出来，采不采用是消费者的事）；
- 不改脚本的存储方式与草稿机制（只在编辑器那一侧补冲突语义）。

## 3. 设计

### 3.1 边界：应用自己的文件 vs 图库目录

`fs/` 管**应用自己管的文件**：`settings.yml`、`scripts/`、`temp/`、`logs/`、库文件与备份。

**用户图库目录的遍历不进这一层**（`image/walk.ts` 保留自己的 fs 访问）：那是外部数据、要按解码内存预算分批、要容忍随时变的权限与并发，与「小文件的热加载」不是一个问题。这条边界要写在文档里，否则「统一」会被理解成「什么都塞进 fs/」。

### 3.2 模块与对外契约

```
src/main/fs/
├── index.ts      唯一出口（具名再导出）：业务模块只 import @/fs
├── snapshot.ts   读与「变没变」
├── write.ts      写；写成功登记「自写标记」
└── watch.ts      监听（内部用 chokidar）
```

```ts
// snapshot.ts
readTextIfChanged(path): Promise<{ text: string; changed: boolean }>   // 按 path + mtime + size 复用，不重读盘
hasChangedOnDisk(path): Promise<boolean>                               // 只 stat
statOrNull(path): Promise<Stats | null>                                // 替代裸 access/stat 试探
forgetSnapshot(path): void                                             // 删文件 / 自己刚写完 / 用例清理

// write.ts
writeFileAtomic(path, content): Promise<void>   // 临时文件 + rename；成功后登记自写标记
ensureDir(path): Promise<void>                  // 幂等递归
removeFile(path): Promise<void>                 // ENOENT 视为成功
copyFile(from, to): Promise<void>               // 异步复制，替换两处 copyFileSync

// watch.ts
watchPaths(paths, onChange: (changed: string[]) => void): () => void   // 文件或目录，非递归；返回值即注销
revalidateAll(): Promise<void>                                         // 手动兜底：焦点 / 目录重建 / 网络盘
closeAllWatchers(): void                                               // before-quit 统一收尾
```

若实现时 `write.ts` 超过约 120 行，把自写标记拆成 `marks.ts`——它是「我们自己的写不回声」这条不变量的落点。

### 3.3 不变量

1. **只上报真的变了**：事件 → 稳定性窗口 → `hasChangedOnDisk` → 命中才回调。消费者不会收到白跑的通知。
2. **自己的写不回声**：`writeFileAtomic` / `copyFile` 成功即登记 `path → { mtimeMs, size }`，监听层认出并丢弃那次事件；读取采纳后清除。写入有唯一咽喉，所以这条能精确成立，而不是「写完静默 N 毫秒」。
3. **失败不降级**：读不到（原子保存的中间态）或解析失败**不改变任何内存态**，只记一条 warn。「退回默认值」只属于**启动首读**。
4. **注销就是返回值**，与 `onThemeChange()` / `useIpcListener()` 同形。
5. **`persistent: false`**，`closeAllWatchers()` 挂在 `before-quit`：watcher 不许像 worker 那样把进程拽住。
6. **目录被删/重建要重挂**；另有 `revalidateAll()` 在窗口获得焦点时兜底（网络家目录、事件丢失）。
7. **层不引 electron**：可测性靠这一条，用例用真实临时目录跑（`test/setup/temp-dir.ts` 已有，做法同 `test/main/ups/engine.test.ts`）。焦点那根线写在 `main/index.ts`。
8. **层不含业务**：不认识「脚本」「设置」，不解析 YAML，不决定「变了该做什么」。

### 3.4 依赖：chokidar，打进产物

- **引 `chokidar`**：跨平台文件监听的既成标准（webpack、vite dev server、jest 用过），原子保存（临时文件 + rename）、目录重建、事件抖动、平台差异都包在里面。
- **取 5 而不是 4**：树里已经有 `chokidar@5.0.0`（`vue-router` 的依赖），声明同一范围 → 只有一份，不会出现「根上 5、嵌套 4」的解析歧义。
- **因为 5 是 ESM-only 而主进程产物是 CJS，所以打进产物而不是外置**：`electron.vite.config.ts` 的 `main` 加 `ssr: { noExternal: ['chokidar'] }`（Vite 的 SSR 构建默认外置所有裸导入，这是「只打包这一个」的开关）。
- **因此落在 `devDependencies`**：与 AGENTS 的「依赖分区」一致（打进产物的包不进 `dependencies`），安装目录也不会多一份拷贝。
- 需要使用者执行 `yarn add -D chokidar@^5.0.0`（本仓不动 `package.json`）。

### 3.5 触发：watcher 为主，焦点校验兜底

- 主：`watchPaths()` 变化后按 3.3 的判定回调。
- 兜底：`app.on('browser-window-focus')` → `revalidateAll()`（每个被监听路径一次 stat）。它覆盖 chokidar 也救不了的情况：家目录在网络盘上、事件丢失、目录被删后重建。
- 退出：`before-quit` 里 `closeAllWatchers()`。

## 4. 两个消费者

### 4.1 设置热加载

- 首读与热加载都走 `readTextIfChanged`；`watchPaths([getSettingsPath()], reload)`。
- reload 的三档：**读不到/解析不了** → 保持当前内存 + warn；**解析成功但某项非法** → 应用好的键、坏的退回默认并标记；**与内存深比较相等** → 什么都不做（顺带吃掉自己的写回回声）。
- 应用 = `nativeTheme.themeSource` + 通知订阅者（窗口配色 + `settings:changed` 广播）。**渲染进程零改动**：设置页与四个入口早就订阅了这条通道。
- 为「启动时固化」的项（日志级别那类）预留 `pendingRestart: string[]`：界面显示「文件里的值与当前生效值不同，需重启」，而不是悄悄不生效。日志级别那条设置项本身仍在 [settings-page.md](./settings-page.md) 的剩余项里，这里只留位置。

### 4.2 脚本：类型索引走 watcher，编辑器缓冲走焦点

| 半边 | 触发 | 行为 |
|---|---|---|
| 列表与**类型索引** | `watchPaths([getScriptsDir()], …)` | 命中 → 查库 → `detectScriptTypes()` 重测 → **类型或存在性变了才**更新关联 → 推 `script:changed`（受影响条目）；列表就地更新。不推「内容变了」这种无信息量的事件 |
| 编辑器缓冲 | **窗口获得焦点** | 脚本页 invoke `script:revalidate(activeId)`：不脏 → 静默重载（正文 + `baseline` + markers）；**脏 → 原生确认框**（`dialog-service` 的 `confirmDialog()`）「磁盘上的文件已改变。重新加载会放弃你未保存的修改。」确认 = 重新加载、取消 = 保留我的修改；文件被外部删掉 → 走已有的「脚本文件不存在」 |

**新不变量**（要补进 `script-management.md`）：快照缓存描述**磁盘**，编辑器缓冲描述**内存**，两者不互相污染；只有选「重新加载」才把磁盘内容写进缓冲区，选「保留」之后的下一次保存以编辑器这份为准并覆盖磁盘。

## 5. 模块引用收敛为静态 import

三处 `require` 全部改成文件顶部的静态 import（`tsconfig.node.json` 已开 `esModuleInterop`，三个依赖都是 dual 格式且都带类型）：

| 位置 | 改成 | 顺带 |
|---|---|---|
| `script/compile.ts:24` | `import Module from 'node:module'`（`@types/node` 是 `export = Module`，所以走默认导入） | 删掉只用一次的 `ModuleConstructor` 断言接口 |
| `image/walk.ts:20` | `import { imageSizeFromFile } from 'image-size/fromFile'` | 删掉已过期的「不交给打包器内联」注释 |
| `image/thumbnail-sharp.ts:38-105` | `import sharp from 'sharp'` | 删掉五个手写结构接口（`SharpInputOptions` / `SharpMetadata` / `SharpOutputInfo` / `SharpInstance` / `SharpFactory`）、`sharpFactory` / `loadError`、try/catch、`requireSharp()` 与那句 `install with: yarn add sharp`，约 45 行；`sharp` 的加载代价仍只落在 worker（`thumbnail-worker.ts` 才 import 它，`?nodeWorker` 只在 spawn 时求值） |

**不做**：sharp 缺失的处理（不可达路径，见背景第 5 条），因此没有补偿逻辑——`ARCHITECTURE.md` 里「加载失败会直接报错」那句保持原样。

## 6. 强制收口：两条 ESLint 边界

- `src/main/**` 的 `no-restricted-imports` 禁 `fs` / `node:fs` / `fs/promises` / `node:fs/promises`，例外四个文件并写明理由：`src/main/fs/**`（层的实现）、`src/main/image/walk.ts`（图库遍历，见 3.1）、`src/main/log/logger.ts`（启动自举：`setupLogging()` 在 app ready 之前跑）、`src/main/database/db.ts`（`node:sqlite` 是同步 API，开库路径上同步建目录是一致的）。
- `@typescript-eslint/no-require-imports` 保持 error，**例外清单清空**（第 5 节之后不再需要）。
- `no-restricted-syntax` 增加一条禁 `ImportExpression`（动态 `import()`），与既有的禁 `import *` / `export *` 两条同形。

## 7. 落地顺序

1. **层**：`src/main/fs/` 四个文件 + 第 6 节的两条守卫 + 单测。
2. **迁移调用点**：`script/files.ts`（原子写与快照改走层）、`settings/store.ts`（不再借脚本模块的写入）、`ups/engine.ts`、`task/runners/export.ts`、`database/db.ts` 的 `copyFileSync` → 全部走层（行为不变，只把同步改异步）。
3. **静态 import 收敛**（第 5 节）。
4. **设置热加载** + `pendingRestart` 预留。
5. **脚本外部改动**：类型索引 + `script:changed` + 焦点校验与原生确认框。
6. **`image/walk.ts` 同步遍历改异步**（独立一笔：修既有缺陷，与本方案可分别回滚）。

六笔都在本版（1.1.2）落地。①②③⑥ 不含界面行为，可以先合、逐笔验；④⑤ 要动渲染进程与界面，排在 [renderer-preload.md](./renderer-preload.md) 之前，届时新增的渲染进程侧调用会在那一项里一起迁到 preload。

## 8. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/main/fs/{index,snapshot,write,watch}.ts` | 第 3.2 节的契约与第 3.3 节的不变量 |
| **新增** `test/main/fs/*.test.ts` | 临时目录用例：快照复用与失效、自写回声、连续事件合并、`revalidateAll`、`removeFile` 幂等 |
| `src/main/settings/store.ts` | 读走快照；`watchPaths` 接热加载；reload 三档策略；`pendingRestart` |
| `src/main/script/files.ts` | 私有快照缓存删掉，读写走层；保留脚本域的路径与命名约定 |
| `src/main/script/library.ts`、`script/ipc.ts` | 类型索引刷新、`script:changed` 推送、`script:revalidate` 命令 |
| `src/main/ups/engine.ts`、`task/runners/export.ts`、`database/db.ts` | 裸 fs 与同步调用改走层 |
| `src/main/image/{thumbnail-sharp,walk}.ts`、`src/main/script/compile.ts` | 第 5 节 |
| `src/main/index.ts` | `before-quit` 收 watcher、焦点时 `revalidateAll()` |
| `src/common/ipcChannels.ts` | `script:changed`、`script:revalidate` |
| `src/renderer/views/main/ScriptPage.vue` | 订阅 `script:changed`；焦点校验与冲突流程（用 `dialog-service`） |
| `eslint.config.mjs`、`electron.vite.config.ts` | 第 6 节的守卫；`main` 的 `ssr.noExternal` |
| `docs/design/script-management.md` | 补一节：快照 vs 缓冲的不变量、冲突流程 |
| `docs/roadmap/open-script-in-editor.md` | 非目标那条改为指向本文件 |

## 9. 风险

| 风险 | 应对 |
|---|---|
| 半截文件把设置重置 | 热加载三档策略：读不到/解析失败一律保持当前内存（3.3 第 3 条、4.1） |
| 自己的写引发回调、来回抖动 | 写入有唯一咽喉，按 mtime + size 精确识别自写（3.3 第 2 条） |
| watcher 在网络上收不到事件 | 焦点时 `revalidateAll()` 兜底；文档写明这是已知边界 |
| watcher 把进程拽住 | `persistent: false` + `before-quit` 统一收尾 |
| 目录被删后监听静默失效 | 重挂 + 焦点兜底 |
| 迁移期间行为变化 | 第 2 笔只做「同步改异步 + 走层」，不加任何新行为，可独立验证与回滚 |
| 静态 import 改动 `thumbnail-sharp` 的加载时机 | 它只在 worker 里被加载，不在应用启动路径上；改动后必须真扫一次图冒烟 |

## 10. 验证方法

1. **层的单测**（真实临时目录，不需要 Electron）：同一份内容复用快照、mtime/size 变了才 `changed`、自写回声被吃掉、连续事件合并成一次回调、`revalidateAll()` 手动触发、`removeFile` 幂等、`copyFile` 异步。
2. **消费者纯逻辑单测**：设置的「哪种解析结果该应用、该保持」；脚本的「该不该推 `script:changed`」。
3. **人工冒烟**：
   - 在编辑器里改 `settings.yml` 保存 → 主题不闪、立即生效，设置页的单选同步；
   - 故意写坏 `settings.yml` → 应用不崩、当前主题不变、日志里一条 warn；
   - 外部改脚本的导出函数 → 列表里的类型立即变，扫描的候选列表跟着变；
   - 脚本页有未保存改动时在外部改同一份文件 → 切回窗口弹原生确认框；选「保留」后保存覆盖磁盘，选「重新加载」后草稿被清；
   - 外部删掉脚本文件 → 列表与编辑器都显示「脚本文件不存在」；
   - 打包产物里跑一遍 `grep require("chokidar") out/main/index.js` 应为空（说明它确实被打进产物）。

## 11. 已知取舍

| 取舍 | 代价 |
|---|---|
| 统一到一个 fs 层 | 任何新文件能力都要先想「它属于层还是业务」，层里不写业务判断 |
| 图库目录不纳入 | 两处文件访问风格并存（小文件 vs 大规模遍历），靠文档写明边界 |
| 编辑器缓冲用焦点触发而不是 watcher | 两个窗口并排、应用窗口始终在前台时不会自动刷新；要解决得再给「当前打开的那一份」挂单文件监听 |
| 类型索引即时刷新 | 外部改动会带来一次库写入与一次推送；只在实际变化时才做 |
| chokidar 打进产物 | 主进程产物变大（几百 KB），换来运行时不依赖 ESM/CJS 互操作 |

## 12. 待决事项

无。
