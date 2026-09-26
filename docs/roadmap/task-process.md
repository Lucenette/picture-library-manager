# 任务独立进程与全任务断点续跑

**状态**：待实施
**关联**：[ARCHITECTURE.md](../ARCHITECTURE.md) 的「进程模型」「任务系统」两节

---

## 1. 背景

现状存在三个问题。

1. **任务在主进程主线程执行。** 任务系统只包含队列、状态机与协作式检查点，不含线程池；除缩略图解码使用
   `worker_threads` 外，其余均在主进程主线程完成：目录遍历使用同步 `fs`（`readdirSync`、
   `statSync`）、读取图片头使用同步的 `image-size`、导出使用 `copyFileSync`、数据库为同步的
   `node:sqlite`、用户脚本经 `Module._compile` 执行。整个主进程未使用任何异步 `fs`。
2. **网络盘上主线程被同步 I/O 阻塞。** 图库位于 SMB 共享时，每次 `stat` 均为一次网络往返，而遍历的
   让出粒度为每 200 个条目（按本地磁盘设定）。实测表现为窗口拖动与新建窗口出现数秒级卡顿，同期 CPU
   接近 0、网络占用饱和、内存不变。同一图库在「写入图片」阶段由工作线程读取文件时界面流畅，
   表明瓶颈不在 I/O 总量，而在同步 I/O 占用了主线程。
3. **任务中断后只能从零重跑。** 暂停中的任务在正常退出时被标记为 `cancelled`，强制结束进程或断电后由
   `restore()` 标记为 `failed`；唯一补救手段是重试，而扫描的重试会先执行 `clearSourceData`，
   已写入的结果被清除。

## 2. 目标与非目标

**目标**

1. 全部任务迁入独立进程，主进程与渲染进程不再受任务负载影响；
2. 任务进程内部以异步为主，保证暂停与取消请求可被及时响应；
3. **全部任务支持断点续跑**：暂停 → 退出应用 → 关机重启 → 继续执行；
4. 退出时若存在正在运行且未暂停的任务，先行询问：暂停并退出 / 停止并退出 / 取消退出；
5. 强制结束进程、直接断电等无法拦截的场景，损失有上限。

**非目标**

- 不做跨机器迁移；不改变任务并发度（仍恒为 1）；不改动渲染进程界面（除退出询问弹窗外）。

## 3. 进程模型与目录结构

采用 **`utilityProcess.fork()`**，不新增渲染进程。理由：具备独立事件循环（同步代码不阻塞其他进程）；
不创建窗口（否则该窗口会阻止 `window-all-closed` 触发，导致「关闭窗口后进程不退出」问题复现）；
Node API 完整（sharp 已实测可在 `ELECTRON_RUN_AS_NODE` 环境加载）；IPC 基于 `MessagePort`；
崩溃仅影响该进程。

```
src/
  common/                 跨进程契约（引入第三个进程后，准入规则扩展为"任意两个进程共用"）
    types.ts
    ipcChannels.ts
    taskProtocol.ts       ← 新增：主进程与任务进程的消息及 RPC 定义
  main/                   主进程：窗口、数据库（唯一写者）、对外命令、编排
    database/            唯一写者；仅此模块打开数据库连接
    window-manager.ts
    dialogs/              含新增的退出询问弹窗
    task/
      manager.ts          队列、状态机、游标落库、恢复、向界面推送
      bridge.ts           ← 新增：任务进程的启动与回收、消息、RPC、ack 超时、崩溃处理
      ipc.ts              渲染进程的 task:* 命令（界面契约不变）
  task-process/           ← 新增：任务进程
    index.ts              入口：端口消息循环
    task-control.ts       暂停、取消、检查点（自 main/task 迁移）
    runners/{scan,process,export,similar}.ts
    image/                整体迁移：目录遍历与解码线程池（当前仅被任务使用）
    script/               整体迁移：脚本编译与调用（例外见第 7.1 节）
  renderer/               仅界面
```

**AGENTS.md 的分层规则相应改为四行**：主进程负责窗口、数据库与 IPC 编排；任务进程负责后台任务执行
（允许同步代码，但不得长时间不让出事件循环）；渲染进程仅负责界面；`common/` 存放跨进程契约。

## 4. 断点续跑：以数据库为游标

原则：**可从数据库推导的状态不予单独记录**；`task` 表只保存阶段与粗粒度位置。

```sql
ALTER TABLE task ADD COLUMN cursor TEXT;      -- JSON，结构由各 runner 定义
ALTER TABLE task ADD COLUMN attempts INTEGER; -- 崩溃自动续跑次数，防止崩溃循环
```

**写入顺序约束：先写数据，再推进游标。** 崩溃时游标必然落后于数据，重做的片段须幂等。
游标落库节奏：与进度写库使用同一节流（不小于 1 秒），并在每个单元结束后立即写入一次；
因此强制结束进程时的损失上限为 1 秒加一个单元。

| 任务 | 以数据库为准的部分 | 游标仅记录 | 续跑方式 |
|---|---|---|---|
| scan | `image_file` 行（`thumbnail IS NULL` 表示尚未处理） | phase（collect / thumbnail）、角色与组、文件下标、累计计数、引擎 | 收集阶段改为边遍历边 `INSERT OR IGNORE` 写入文件行；缩略图阶段查询 `thumbnail IS NULL` 逐条补齐，成功后 `UPDATE` |
| process | `processed_image` 行 | groupIds 快照、下标、累计 processed 与 failed | 跳过已有选图结果的组 |
| export | 目标目录（不便于查询，故使用游标） | imageIds、下标、累计 copied 与 failed | 自下标继续复制；重复复制会覆盖同名文件，无害 |
| similar | 结果表（最后一次性原子写入） | phase、left | 比对是确定性计算，从 0 重算（见第 13 节） |

> scan 的上述改造带来一项额外收益：**补做超大图与断点续跑是同一机制**——均为「查询
> `thumbnail IS NULL` 后逐条补齐」。超大图「最后单线程、不设像素上限重试」的实现落在这条路径上。

## 5. 进程间协议

协议定义置于 `common/taskProtocol.ts`，全部经 `postMessage` 传递；带 `requestId` 的消息必须有
ack 或超时。

**主进程 → 任务进程**

| 消息 | 载荷 | 语义 |
|---|---|---|
| `run` | `{ taskId, type, payload, cursor }` | 开始执行，或自游标继续 |
| `pause` | `{ taskId }` | 在下一个检查点挂起 |
| `resume` | `{ taskId }` | 解除挂起 |
| `cancel` | `{ taskId }` | 进入终态；在下一个检查点抛出 `TaskCancelledError` |
| `rpcResult` | `{ requestId, ok, value 或 error }` | 回应任务进程发起的 RPC |

**任务进程 → 主进程**

| 消息 | 载荷 | 语义 |
|---|---|---|
| `progress` | `{ taskId, progress, message, cursor }` | 节流推送；游标与进度同批落库 |
| `ack` | `{ requestId, kind: 'paused' 或 'cancelled' }` | 暂停与取消必须 ack，主进程收到后才继续退出流程 |
| `finished` | `{ taskId, status, result, error }` | 终态 |
| `rpc` | `{ requestId, method, args }` | 请求主进程代为读写数据库或探测脚本 |
| `log` | `{ level, message }` | 转发至主进程日志；stdout 与 stderr 一并接入 |

超过超时阈值（建议 3 秒）视为任务进程无响应：终止该进程，并按第 8.3 节处理。

## 6. 数据库写入：保持单一写者

- 任务进程**不打开数据库**，全部读写经 `rpc` 交由主进程的 `database/db.ts` 执行。
- 因此**不存在跨进程事务**：`beginBatch` 与 `endBatch` 对任务进程不可用。
  - scan 当前已是逐张自动提交，符合要求；
  - **process 与 export 目前包在 `beginBatch` 与 `endBatch` 之间，需改为逐单元提交**，这对续跑也更为正确。
- 仅暴露任务所需的窄接口，不提供「可调用任意数据库方法」的能力：

```
taskDb.clearSource(sourceId)
taskDb.insertCharacter / insertGroup / insertFileRow
taskDb.updateFileMedia(filePath, thumbnail, phash, width, height)
taskDb.listFilesMissingMedia(sourceId)      // 续跑与补做大图共用
taskDb.listSelectedFiles()                   // similar 的输入
taskDb.upsertProcessedImage(...) / listGroupsMissingResult(payload)
taskDb.listExportTargets(imageIds)
taskDb.replaceSimilarResult(...)             // 一次性原子写入
```

窄接口有两点收益：载荷可控（避免跨进程传输数 MB 的缩略图）；主进程侧可自行决定索引与事务边界。

**后续可选优化**：任务进程以 `new DatabaseSync(path, { readOnly: true })` 打开只读连接
（WAL 支持多读者），导出与选图等批量读取不再经过端口；写入始终由主进程独占。

## 7. 模块归属调整

**7.1 `script/`**：`compile.ts` 同时被主进程的脚本管理（`importScript`、`reloadScriptFromFile`
需探测导出类型）与 runner 使用，且内部使用 `Module._compile`，**不可置于 `common/`**——渲染进程会
将 Node 依赖打入包中，这正是此前把 `common/script.ts` 迁回 `main/` 的原因。方案：`script/` 整体
迁入任务进程，主进程经 `rpc: scriptProbe(code)` 取得探测结果。

**7.2 `image/` 整体迁移**：`walk.ts` 与 `thumbnail-*` 仅被任务使用，主进程不再需要图片流水线。

**7.3 `manager.ts` 拆分**：留在主进程的是任务行、队列、状态机、游标落库、恢复与界面推送；
委托任务进程的是 runner 执行。`bridge.ts` 是唯一与任务进程通信的模块。

## 8. 退出与恢复语义

### 8.1 启动时的恢复规则

| 上次遗留状态 | 现状 | 调整后 |
|---|---|---|
| `pending` | 继续排队 | 不变 |
| `paused` | 标记为 failed | **保持 `paused`**，界面显示已暂停，由用户选择继续 |
| `running`（正常退出） | 一律标记为 `cancelled` | 按退出询问弹窗中的选择处理 |
| `running`（强制结束进程或断电） | 标记为 failed | **重置为 `pending` 并自动续跑**，受 `attempts` 限制 |

### 8.2 退出询问

存在正在运行且未暂停的任务时，在 `before-quit` 中提供三个选项：

- **暂停并退出**（默认）：发送 `pause`，等待 `ack(paused)`（超时 3 秒），落库 `paused` 与游标后退出；
- **停止并退出**：发送 `cancel`，等待 `ack`（超时 2 秒），落库 `cancelled` 后退出；
- **取消退出**：调用 `event.preventDefault()`，返回应用。

实现要点（Electron 已知陷阱）：`before-quit` 需异步化，即 `preventDefault()` 配合 `isQuitting`
标志，处理完成后再调用 `app.quit()`；弹窗自身是一个窗口，在 `isQuitting` 期间以及任务进程已终止时
不得出现；退出前须显式终止任务进程，否则会如同此前的 worker 线程导致进程无法退出；
`powerMonitor.on('shutdown')`（Windows 与 Linux）走同一流程，但**不等待 ack**。

### 8.3 无法拦截的场景

**不依赖退出流程**：游标由任务进程自行按节拍落库，强制结束进程时的损失上限即该间隔。
重启后按第 8.1 节自动续跑。

## 9. 任务进程内的响应性

进程独立后，任务进程自身的阻塞仍会延迟 `pause` 与 `cancel` 的处理，规则与现状一致，判据有所不同：

| 规则 | 说明 |
|---|---|
| 单元边界必须调用 `await checkpoint()` | 与现状一致；该调用同时是消息处理点 |
| 长循环分片 | 每 N 次调用 `await setImmediate`（遍历、比对） |
| **遍历改用 `fs.promises`** | 目的不是界面流畅，而是使任务进程能及时收到 `pause`，与 SMB 场景同理 |
| 单次不可中断的重计算 | 仍交由进程内的 `worker_threads` 解码池 |
| 数据库访问 | 全部经 RPC（天然异步），不在任务进程内同步写入 |

## 10. 构建、打包与调试

| 项 | 方案 |
|---|---|
| 构建 | 任务进程作为**主进程构建的第二个入口**（`rollupOptions.input`），产出 `out/main/task-process.js`，由 `fork(join(__dirname, 'task-process.js'))` 启动。置于同一构建内，`?nodeWorker` 的解码池 chunk 才能继续工作 |
| 打包 | `electron-builder` 需对 sharp（`@img/sharp-*`）与任务进程产物做 `asarUnpack`；确认 `files` 覆盖 `out/**` |
| 生命周期 | 存在非终态任务时保持存活；空闲 N 秒后终止以释放内存；下次提交时重新 fork（fork 与 sharp 首次加载合计约 200 至 300ms） |
| 调试 | 开发态通过 `execArgv: ['--inspect=9229']` 附加调试器；stdout 与 stderr 接入主进程日志；崩溃时打印退出码与最后一条消息 |
| 开发流程 | 修改任务进程代码后由 electron-vite 重建主进程，主进程重启时自然重新 fork，无需额外机制 |

## 11. 风险

1. **退出时未完全回收进程** → 应用无法退出（此前已出现两次：worker 线程、隐藏窗口）。对策：显式终止、
   设置超时，并在缺失 ack 时兜底。
2. **不存在跨进程事务** → runner 中的 `beginBatch` 与 `endBatch` 须改为逐单元提交。
3. **游标可能领先于数据** → 以「先写数据、后推游标」与全部写操作幂等消除。
4. **RPC 往返开销**（scan 每张一次 insert）：单次为亚毫秒级，可接受；若后续达到百万行量级，
   再考虑批量 RPC（单条消息携带 100 行）。
5. **崩溃循环** → 由 `attempts` 限次（建议自动续跑 1 次），超出后标记 failed 并写明原因。
6. **暂停与取消的延迟仍由单元粒度决定**（与现状相同）：单元为一张图或一个组；
   「同步整图解码不可中断」这一性质不因迁移进程而改变。
7. **调试难度上升** → 每条消息均需携带 `taskId` 与步骤标识。

## 12. 实施顺序

本项为一次重构，按下列顺序实施，每步均可独立验证。

1. **游标与幂等**：`task` 表增加 `cursor` 与 `attempts`；scan 改为边收集边写行、缩略图阶段以
   `UPDATE` 补齐；process 与 export 取消 batch，改为逐单元提交；`restore()` 调整为
   「running 重置为 pending、paused 保持」。*此步完成后，进程内的断点续跑即已成立，可先行验证。*
2. **退出询问弹窗**：异步化 `before-quit`，实现三选一原生弹窗，并接通三种选择与恢复规则的衔接。
3. **迁移进程**：新增 `src/task-process/`，迁移 runner、image 与 script；新增 `bridge.ts` 与
   `taskProtocol.ts`；收窄主进程侧的数据库 RPC；逐一验证四类任务。
4. **响应性与并发**：任务进程内遍历改用 `fs.promises`；解码池随迁；验证暂停与取消的响应延迟。
5. **收尾**：构建、打包与 `asarUnpack`；更新 `AGENTS.md`（分层规则四行）、`ARCHITECTURE.md`
   （进程模型图、续跑语义、退出弹窗）、`README.md`（目录树）与 `TROUBLESHOOTING.md`
   （`utilityProcess` 调试、`?nodeWorker`）。

## 13. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | `paused` 在重启后保持暂停等待用户继续，还是自动继续 | 保持暂停，尊重用户意图 |
| 2 | `running` 崩溃重启后自动续跑，还是标记失败等待手动重试 | 自动续跑 1 次 |
| 3 | `similar` 的续跑：接受从 0 重算比对，还是实现分块续跑 | 从 0 重算，确定性强且实现简单 |
| 4 | 退出弹窗新建窗口，还是将 `ConfirmDialog` 扩展为三按钮 | 待定；后者省去一种窗口类型，但需改动其契约与 13 处调用点 |

## 14. 设计结论：不引入继承体系

统一接口已经存在（`TaskRunner = (ctx) => Promise<TaskResult>` 配合
`Record<TaskType, TaskRunner>` 的编译期穷举）。任务类型固定为四种，不需要运行时多态替换，
也不存在需要跨调用维护的不变量。断点续跑引入的公共脚手架（游标读写、单元循环、RPC 封装、日志）
以**组合**方式抽取即可：具有内部状态机的部分使用 class（`CursorStore`、`TaskRpc`，以及既有的
`ThumbnailPool`），一次性流程使用函数。引入基类继承会导致抽象泄漏（export 无「组」概念、
similar 无「组与文件」概念），最终在基类中累积按类型分支的判断，可维护性低于现状。
