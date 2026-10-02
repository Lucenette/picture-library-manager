# 相似图片识别：CLIP 语义向量与 sqlite-vec

**状态**：待评审
**关联**：[similar-manage.md](./similar-manage.md)（同一子系统：本条目管「怎么认出相似」，它管「认出之后怎么处理」）、[task-process.md](./task-process.md)（嵌入产出随任务迁移进程）、[build-targets.md](./build-targets.md)（原生件的架构矩阵）
**落地去向**：本条目与 [similar-manage.md](./similar-manage.md) 同属「相似图片」一个子系统。两者都落地后，本文**不单独 `git mv` 到 `docs/design/`**，而是并入由 `similar-manage.md` 迁移而来的那份设计说明，避免一个子系统拆成两份设计文档。

---

## 1. 背景

1. 现有识别只有**一个维度**：64 位感知哈希（pHash，8 字节）。它算在缩略图的灰度 DCT 低频上（`src/main/image/thumbnail-sharp.ts` 的 `perceptualHash`），比对是 `src/main/image/similar.ts` 的汉明距离，分组阈值是 `SAME_DISTANCE = 3` 与 `SIMILAR_DISTANCE = 10`。
2. pHash 抗重压缩、抗分辨率变化，但**对裁切、换画风、换背景不敏感**——同一角色的不同构图会被判为不相似；它看的是「像素低频布局」，不是「画面内容」。
3. 规模的实测出处：开发库 `dist/data/picture-lib.db`（3.5 MB）当前 `processed_image` 135 条、`image_file` 806 条且全部有 phash（实测，2026-10-02）。相似识别只吃 `processed_image`，所以此刻两两比对（135 选 2 = 9075 次）是毫秒级的；真正的复杂度压力来自将来图库到数千张、且比对维度从 8 字节变成数百字节。
4. CLIP 推理需要 ONNX Runtime（`onnxruntime-node`，N-API 插件）。它与现有 `sharp` 同属「不需要 electron-rebuild、但必须按平台与架构提供预编译二进制」的一类，因此 `asarUnpack` 与 [build-targets.md](./build-targets.md) 的架构矩阵要跟着更新。
5. sqlite-vec 是 SQLite **可加载扩展**（纯 C，不是 Node 插件），不涉及 rebuild；但它要求宿主 SQLite 允许动态加载。本项目用的是 Electron 内置的 `node:sqlite`，其是否被编译成 `SQLITE_OMIT_LOAD_EXTENSION` **必须先实测**——这是本条目里唯一可能推翻检索层做法的未知量。

### 1.1 修改历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-02 | 首次定稿 | — |

---

## 2. 目标与非目标

**目标**

1. 为图库里每张**已选定**的图片产出一个语义向量（CLIP 嵌入），与 pHash 并存、随选图链路落库。
2. 相似识别在 pHash 之上增加**语义维度**：同角色、同主题的不同构图能聚到一起；结果里能区分「像素几乎相同」与「语义相似」。
3. 向量检索有明确落点：优先放进 `picture-lib.db`；宿主不支持扩展时退化为普通表加内存暴力检索，**功能不回退**。
4. 落地后并入相似图片子系统的设计说明，不新增 `docs/design/` 文档。

**非目标**

- 不做模型训练与微调，只用现成预训练权重；
- 不做云端推理，图片不出本机；
- 第一版不做自然语言搜索与自动打标（语义向量的自然延伸，见第 7 节）；
- 不替换 pHash，两者互补。

## 3. 设计

### 3.1 两层识别：pHash 保底、CLIP 提语义

- 第一层沿用现有 pHash，先连出「相同组」。
- 第二层由现在的「相同组之间按汉明距离连」改为「按 CLIP 余弦相似度连」。
- 展示上仍是 `same` / `similar` 两类，分别对应「像素近乎相同」与「语义相近」。`similar_member.distance` 现在是不带小数的汉明距离，语义层需要能表达相似度。
- 阈值不写死在代码里，集中成常量，并与 [settings-page.md](./settings-page.md) 里现有的相似阈值口径保持一致。

### 3.2 嵌入的产出

- 对象是 `processed_image.selected_file` 那一张，与现有相似识别的输入一致，不是全部 `image_file`。
- 图像预处理复用 sharp 的 resize（CLIP 输入 224×224、归一化），不再引第二套解码。
- 推理放任务系统，在工作线程或任务进程里做，不占主进程主线程——沿用 `thumbnail-pool` 的线程边界。

### 3.3 存储与版本

- 新表存向量，例如 `image_embedding(processed_image_id, model, dim, vector BLOB)`；`model` 用于换模型后识别哪些需要重算。
- 512 维 float32 约 2 KB 一张：当前 135 张不足 1 MB，一万张约 20 MB，可接受；规模继续涨再考虑量化（int8 / 二值）。
- 建表走版本目录，写进 `src/main/ups/changesets/<版本>/dbups.xml`，不在代码里建表（见 [ups.md](../design/ups.md)）。

### 3.4 检索层：先暴力内核，sqlite-vec 作为可选增强

- 先实现一个纯逻辑的最近邻（归一向量的余弦内积，内存暴力）。它覆盖当前规模，也是带不带 `sqlite-vec` 都成立的内核。
- 若 Electron 内置的 `node:sqlite` 实测允许加载扩展：加 `vec0` 虚拟表作为索引，接同一个内核的接口。
- 若确实需要近似最近邻、而宿主又不支持加载扩展：换 `better-sqlite3` 是唯一现实退路，但它是**非 N-API 插件**，会引入 electron-rebuild、ABI 与现有 `npmRebuild: false` 的冲突，须单列评审，不在本条目内直接做。

### 3.5 与现有相似任务的关系

- 仍是一次 similar 任务：读向量、算近邻、分组，落 `similar_run` / `similar_group` / `similar_member`。
- 增量：新选定一张只算它自己的向量并与已有向量比对，不必整批重算；只有换模型才触发整批重算（靠 `model` 列识别）。
- 失败可见：某张推理失败只计入失败数，不拖垮整轮，口径与现有缩略图失败计数一致。

## 4. 改动清单

| 位置 | 改动 |
|---|---|
| **新增** `src/main/image/embedding.ts` | 加载 ONNX Runtime 与 CLIP 权重、预处理、产出向量 |
| **新增** `src/main/image/vector-search.ts` | 归一化、余弦、暴力 kNN；有扩展时接 `vec0` |
| `src/main/image/similar.ts` | 第二层由汉明距离改为余弦相似度；阈值常量 |
| `src/main/task/runners/similar.ts` | 产出与读取向量、写结果 |
| `src/main/database/db.ts`、`src/main/database/sql.ts` | `image_embedding` 读写与相似查询 |
| **新增** `src/main/ups/changesets/<版本>/dbups.xml` | 建 `image_embedding` 表 |
| `src/common/types.ts` | 相似结果字段允许浮点相似度 |
| `package.json` | 加 `onnxruntime-node`（**需使用者批准**） |
| `electron-builder.yml` | `asarUnpack` 覆盖 ONNX Runtime 二进制，按架构分发 |
| `docs/design/`（落地后） | 并入相似图片子系统的设计说明，**不新建文件** |

## 5. 风险

| 风险 | 应对 |
|---|---|
| `node:sqlite` 不支持加载扩展 | 检索层不依赖扩展：暴力内核先落地，扩展只作加速 |
| 原生件的架构矩阵（ia32 / arm64） | 跟着 [build-targets.md](./build-targets.md) 的结论；没有对应二进制的架构不发 |
| 模型体积与首次获取方式 | 打包还是首次下载需先定；下载要校验、失败要可见 |
| 权重许可 | 选许可允许再分发的模型；不明确就由使用者在首次下载时确认 |
| 推理耗时 | 与模型和 CPU 相关，落地时实测后写进文档，不预先编数字 |
| CLIP 相似度分布平坦、固定阈值易误判 | 阈值集中可配；用同角色样本标定；分组优先用 kNN 图而非单一阈值链 |
| 泄漏真实图片 | 全程本地推理；日志不记录图片内容，只记数量与耗时 |

## 6. 验证方法

1. 纯逻辑：向量归一化、余弦、暴力 kNN、连通分量分组——在固定小样本上跑断言，不启动 Electron。
2. 阈值标定：取一组已知同角色、不同构图的图，确认语义层能把它们聚到一起，而 pHash 层不会。
3. 宿主能力：在 Electron 里实测 `node:sqlite` 的扩展加载（`new DatabaseSync(path, { allowExtension: true })` 后 `loadExtension(...)` 加载 sqlite-vec），记录成功与否，再决定是否启用扩展路径。
4. 人工冒烟：跑一次相似识别，确认两类分组在界面上可区分、单张推理失败不影响整轮、重复运行的结论稳定。
5. 性能：记录 N 张推理总耗时与单次查询耗时，作为是否引入近似最近邻的依据。

## 7. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 模型：OpenAI CLIP ViT-B/32 / Chinese-CLIP / SigLIP | 中文场景优先 Chinese-CLIP |
| 2 | 权重打包进安装包还是首次运行下载 | 待定，由体积与许可决定 |
| 3 | 检索层：暴力 / sqlite-vec / better-sqlite3 | 先暴力；宿主实测支持再加 sqlite-vec；better-sqlite3 单列评审 |
| 4 | 分组算法：阈值加并查集 / kNN 图加连通分量 | kNN 图，避免单一阈值的链式误连 |
| 5 | 是否同时做自然语言搜索与自动打标 | 后置，单列条目 |
| 6 | 向量维度与量化 | float32 起步，规模上来再量化 |
