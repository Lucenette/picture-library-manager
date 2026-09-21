# 任务剩余耗时估算

**状态**：待实施
**关联**：[task-process.md](./task-process.md)（进度推送会携带该字段）

---

## 1. 背景与目标

任务运行期间，任务列表只显示已用耗时，无法判断还需等待多久。扫描类任务的运行时间可达数十分钟，
缺少剩余时间意味着只能反复查看进度。

本方案提供**量级正确**的粗略估算，不追求精确；读数随最近若干个单元的耗时波动，属预期行为。

## 2. 估算规则

```
N   = min(已完成单元数, 5)        // 滑动窗口：最近 5 个单元
avg = 最近 N 个单元的平均耗时      // 完成 1 个取 1 个；完成 6 个取第 2 至第 6 个
eta = (total - done) * avg
展示条件：done >= 1 且累计实测耗时 >= 15 秒
```

**可配置**：相关阈值集中定义为一组常量，修改单个数值即可生效。若后续需要向用户开放配置，
只需替换读取点（例如 `getEtaOptions()`），调用方无需改动。

## 3. 计时口径

- **逐单元计时**：每个单元处理前后各取一次时间，仅累加单元耗时。暂停期间不产生样本，
  因此暂停不会触发展示条件，也不会污染平均值；无需另行记录有效工时。
- **使用 `performance.now()`（单调时钟）**，不使用 `Date.now()`：修改系统时间或 NTP 校时
  不会产生负值或跳变样本。
- 系统休眠的时间无法排除，因此对单个样本设置上限（见第 4 节）。

## 4. 常量

```ts
/** 剩余耗时取最近多少个单元的平均值 */
const ETA_WINDOW_SIZE = 5;

/** 累计实测耗时达到该值后才展示剩余时间：短任务无需展示 */
const ETA_MIN_ELAPSED_MS = 15_000;

/** 单个样本下限：防止 0ms 样本使平均值为 0 */
const SAMPLE_MIN_MS = 1;

/** 单个样本上限：防止系统休眠或时钟跳变污染窗口 */
const SAMPLE_MAX_MS = 3_600_000;

/** 显示上限：超过一年时显示"超过 1 年" */
const ETA_MAX_DISPLAY_SECONDS = 365 * 24 * 3600;
```

## 5. 计量器

```ts
/**
 * 剩余耗时估算。
 *
 * 逐单元计时，仅保留最近 ETA_WINDOW_SIZE 个样本。
 * 全函数：不抛异常、不产生 NaN 或 Infinity；估算失败仅意味着不展示。
 */
class ProgressMeter {
  private readonly samples: number[] = [];
  private measuredMs = 0;
  private done = 0;

  constructor(private readonly total: number) {}

  /** 完成一个单元，将该次耗时压入窗口 */
  advance(startedAtMs: number): void {
    const raw = performance.now() - startedAtMs;
    const clamped = Number.isFinite(raw) ? raw : SAMPLE_MIN_MS;
    const elapsedMs = Math.min(SAMPLE_MAX_MS, Math.max(SAMPLE_MIN_MS, clamped));

    this.done += 1;
    this.measuredMs += elapsedMs;
    this.samples.push(elapsedMs);
    if (this.samples.length > ETA_WINDOW_SIZE) {
      this.samples.shift();
    }
  }

  /** 剩余秒数；不满足展示条件或数据不可信时返回 null */
  get etaSeconds(): number | null {
    if (this.done === 0 || this.samples.length === 0) { return null; }
    if (!Number.isFinite(this.total) || this.total <= 0) { return null; }
    if (this.measuredMs < ETA_MIN_ELAPSED_MS) { return null; }

    const remaining = this.total - this.done;
    if (remaining <= 0) { return 0; }   // 由格式化器输出"不到 1 秒"

    // 唯一的分除数，已由上面的样本数判断保证大于 0
    const avg = this.samples.reduce((sum, ms) => sum + ms, 0) / this.samples.length;
    const eta = (remaining * avg) / 1000;
    return Number.isFinite(eta) && eta >= 0 ? eta : null;
  }
}
```

**按阶段新建计量器**：扫描的收集、缩略图、补做大图三个阶段单元成本差异显著，共用计量器会互相干扰。

## 6. 格式化器

```ts
/** 剩余时间的展示文案；空串表示不展示 */
function formatRemaining(etaSeconds: number | null): string {
  if (etaSeconds === null || !Number.isFinite(etaSeconds)) { return ''; }
  if (etaSeconds < 1) { return '剩余不到 1 秒'; }
  if (etaSeconds >= ETA_MAX_DISPLAY_SECONDS) { return '剩余超过 1 年'; }
  if (etaSeconds < 60) { return '剩余约 ' + Math.max(1, Math.floor(etaSeconds)) + ' 秒'; }
  if (etaSeconds < 3600) { return '剩余约 ' + Math.max(1, Math.floor(etaSeconds / 60)) + ' 分钟'; }
  if (etaSeconds < 86400) { return '剩余约 ' + Math.max(1, Math.floor(etaSeconds / 3600)) + ' 小时'; }
  return '剩余约 ' + Math.max(1, Math.floor(etaSeconds / 86400)) + ' 天';
}
```

各档均使用 `floor` 与 `Math.max(1, ...)`，避免出现"剩余约 60 秒""剩余约 0 分钟"一类越界显示。

## 7. 边界与异常

| 情况 | 处理 | 结果 |
|---|---|---|
| 尚未完成任何单元 | `done === 0` 返回 null | 不展示 |
| 样本数组为空（理论不可达） | `samples.length === 0` 返回 null | 不展示 |
| 累计实测耗时不足 15 秒 | 返回 null | 不展示 |
| `total` 未知、为 0、为负或 NaN（如扫描的收集阶段） | 返回 null | 不展示 |
| `remaining <= 0`（已完成数不少于总数，或续跑后计数失配） | 返回 0 | `剩余不到 1 秒` |
| 单元耗时为 0ms（时钟精度） | 样本下限 1ms | 平均值非 0，不存在除零 |
| 单元耗时异常大（系统休眠后） | 样本上限 1 小时 | 不污染窗口 |
| 平均值为 0 | 由 1ms 下限保证不可达 | — |
| eta 为 NaN、Infinity 或负值 | 返回 null | 不展示 |
| eta 小于 1 秒 | 格式化夹紧 | `剩余不到 1 秒` |
| eta 不小于 1 年 | 格式化夹紧 | `剩余超过 1 年` |
| 中间档位取整越界 | `floor` 与 `max(1, ...)` | 不会显示"约 60 秒" |

**两条约束**

1. 计量器与格式化器均为全函数：不抛异常、不返回 NaN 或 Infinity；唯一的分除数在进入前已由样本数判断排除。
2. 估算仅位于展示路径：调用处统一写作 `meter.etaSeconds ?? null`。估算异常仅导致不展示剩余时间，
   **不得影响任务状态**。

## 8. 各任务的计算单元

| 任务 | 单元 | `total` | 是否展示 |
|---|---|---|---|
| scan · 收集阶段 | 一个目录条目 | **未知**（需遍历完成才可知） | 否 |
| scan · 缩略图阶段 | 一张图 | `totalFiles` | 是（主要场景） |
| scan · 补做大图 | 一张图 | 待补张数 | 是（独立计量器） |
| process | 一个图片组 | `groupIds.length` | 是 |
| export | 一张图 | `imageIds.length` | 是 |
| similar | 一个左下标（一批比较） | `n` | 是（粗估即足够） |

## 9. 展示位置

任务页「耗时」列：

| 情况 | 显示 |
|---|---|
| 运行中，未满 15 秒或尚未完成单元 | `已用 0:12`（维持现状） |
| 运行中，满足展示条件 | `已用 0:24 · 剩余约 5:40` |
| 剩余不足 1 秒 | `已用 0:24 · 剩余不到 1 秒` |
| 剩余超过 1 年 | `已用 1:02:11 · 剩余超过 1 年` |
| 已完成 | `耗时 7:51`（维持现状） |

「已用」沿用任务页现有的 `nowTick` 定时器插值，**不新增定时器**；「剩余」随进度推送更新。

## 10. 改动清单

**不新增数据库列，不新增事件。**

| 位置 | 改动 | 规模 |
|---|---|---|
| **新增** `src/main/task/progress-meter.ts` | 第 4 节常量、第 5 节计量器、第 6 节格式化器 | 约 60 行 |
| `TaskContext.report` | 增加可选参数 `etaSeconds?: number` | 1 行签名 |
| 四个 runner | 每轮计时，调用 `meter.advance(起始时刻)`，并将 `meter.etaSeconds` 传入 `ctx.report` | 每处 2 至 3 行 |
| `common/types.ts` | `TaskProgressEvent` 增加可选字段 `etaSeconds?: number` | 1 行 |
| `manager.reportProgress` | 将 `etaSeconds` 带入推送 | 1 行 |
| `TaskPage.vue` | 「耗时」列拼接文案，复用现有 `formatDuration` | 一个小函数 |

`task` 表及其所有列、现有进度落库与节流均不改动。`TaskProgressEvent` 的字段增加属于推送载荷的类型扩展，
不是数据库列。

## 11. 已知偏差

1. 单元成本差异显著时（1080p JPEG 与五亿像素 PNG 混合）剩余时间会明显波动；窗口取 5 已是折中结果。
2. 「已用」仍按 `now - startedAt` 显示，暂停会使其偏大；精确化需要将有效工时落库，按"不新增列"的约束不做。
3. 窗口内若恰好包含一张超大图，下一次估算偏大，继续处理若干单元后自行收敛。
4. 任务阻塞在单元之外（例如等待网络）时，剩余时间不更新；计量器仅在单元完成时前进。

## 12. 验证方法

1. 扫描一个图库：前 15 秒内「耗时」列仅显示已用，之后出现"剩余约 …"。
2. 中途暂停：已用时间继续增长（属已知偏差），剩余时间不出现跳跃式增长；继续后若干单元内自行收敛。
3. 开发态临时调小 `ETA_WINDOW_SIZE` 与 `ETA_MIN_ELAPSED_MS`，可立即观察到估算结果，便于调参。
4. 观察任务收尾阶段：应显示"剩余不到 1 秒"，而非空白或负值。
5. 构造 `total` 为 0 的任务：不展示剩余时间，且不报错。

## 13. 待决事项

| # | 事项 | 倾向 |
|---|---|---|
| 1 | 常量取 5、15000ms、1ms、1h、1 年 | 是 |
| 2 | 四类任务是否全部接入 | 全部接入（共用计量器，成本可忽略） |
| 3 | 是否为「剩余」增加 tooltip，显示已完成数与平均耗时 | 可选，后置 |
