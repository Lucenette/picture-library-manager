<template>
  <el-scrollbar
    ref="scrollbarRef"
    class="tile-board"
    :class="{ 'selection-active': selectionActive }"
    :max-height="maxHeight"
    @scroll="onScroll"
  >
    <div class="tile-content">
      <div v-if="items.length === 0 && !loading" class="tile-empty">{{ emptyText }}</div>

      <template v-else>
        <div :style="{ height: topSpacerHeight + 'px' }"></div>

        <div v-for="row in visibleRows" :key="row.key" class="tile-row-wrap">
          <div class="tile-row" :style="rowStyle">
            <div
              v-for="item in row.items"
              :key="item.id"
              class="tile-card"
              :class="{ expanded: mode === 'group' && item.id === expandedId }"
            >
              <div class="tile-cover" @click="onCoverClick(item)">
                <!-- 最多三张封面叠着放：第 0 张在最上面，其余两张在下面错开一个角度 -->
                <img
                  v-for="(cover, layer) in item.covers"
                  :key="layer"
                  class="tile-cover-img"
                  :class="'layer-' + layer"
                  :src="cover"
                  :alt="item.title"
                />
                <el-icon v-if="item.covers.length === 0" class="tile-cover-empty" :size="28"><PictureFilled /></el-icon>

                <span v-if="item.count !== null" class="tile-count">{{ item.count }}</span>

                <el-checkbox
                  v-if="selectable"
                  class="tile-check"
                  :model-value="selectState(item.id) === 'checked'"
                  :indeterminate="selectState(item.id) === 'indeterminate'"
                  @click.stop
                  @change="emit('select', item)"
                />

              </div>

              <div class="tile-title" :title="item.title">{{ item.title }}</div>
              <div v-if="item.subtitle" class="tile-subtitle" :title="item.subtitle">{{ item.subtitle }}</div>
            </div>
          </div>

          <!-- 面板挂在它所在那一行的下方、占满整行；一次只展开一个 -->
          <div v-if="row.expandedItem" class="tile-panel">
            <div class="tile-panel-head">
              <span class="tile-panel-title">{{ row.expandedItem.title }}</span>
              <span class="tile-panel-count">{{ row.expandedItem.subtitle }}</span>
              <el-button class="tile-panel-close" text size="small" @click="emit('expand', row.expandedItem)">
                收起
              </el-button>
            </div>
            <slot name="panel" :item="row.expandedItem" />
          </div>
        </div>

        <div :style="{ height: bottomSpacerHeight + 'px' }"></div>
      </template>

      <div v-if="loading" class="tile-loading">加载中…</div>
    </div>
  </el-scrollbar>
</template>

<script setup lang="ts">
import { PictureFilled } from '@element-plus/icons-vue';
import type { ScrollbarInstance } from 'element-plus';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';

import type { TileItem, TileSelectState } from './TileBoard.types';

/**
 * 卡片尺寸与间距的**唯一来源是 CSS 变量**（见下面的样式），脚本只读不写。
 *
 * 窗口化必须知道「一行多高、一行几张」，但这两个数字会随样式调整、也随将来的
 * 「缩略图大小」设置变，所以不在这里再存一份：列数由变量与容器宽度算出来，
 * 行距与面板高度都从真实渲染的 DOM 上量。
 */
const CARD_SIZE_VAR = '--tile-card-size';

const CARD_GAP_VAR = '--tile-gap-x';

/** 变量读不到时的兜底（只可能在挂载后的第一帧用到） */
const FALLBACK_CARD_SIZE = 100;

const FALLBACK_GAP = 18;

const FALLBACK_ROW_HEIGHT = 172;

/** 视口上下各多渲染几行，滚动时不会先露白再补内容 */
const OVERSCAN_ROWS = 2;

/** 距底部不足这么多像素就请求下一页 */
const LOAD_MORE_THRESHOLD = 240;

/** 真正要挂到 DOM 上的一行 */
interface TileRow {
  /** v-for 的键；优先用行首卡片 id，列数变化时也能复用 DOM */
  key: number;
  items: TileItem[];
  expandedItem: TileItem | null;
}

const props = withDefaults(defineProps<{
  items: TileItem[];
  expandedId: number | null;
  selectState: (id: number) => TileSelectState;
  loading?: boolean;
  /** 当前有没有勾选任何一项（内层或外层）：有的话所有复选框常显，没有就只在悬停时出现 */
  selectionActive?: boolean;
  /** `group` ＝ 一级卡片（点封面展开）；`image` ＝ 展开面板里的二级图片（点封面打开查看器） */
  mode?: 'group' | 'image';
  /** 要不要画复选框；图组页的二级图片没有勾选意义 */
  selectable?: boolean;
  /** 空列表时显示的文案 */
  emptyText?: string;
  /** 高度上限（CSS 值）：嵌在展开面板里时用，交给 el-scrollbar 限在滚动视口上，root 才有得滚 */
  maxHeight?: string;
}>(), {
  loading: false,
  selectionActive: false,
  mode: 'group',
  selectable: true,
  emptyText: '暂无数据',
});

const emit = defineEmits<{
  expand: [item: TileItem];
  select: [item: TileItem];
  open: [item: TileItem];
  loadMore: [];
}>();

const scrollbarRef = ref<ScrollbarInstance | null>(null);
const columnCount = ref(1);
const viewportHeight = ref(0);
const scrollTop = ref(0);

/** 卡片边长与间距：从 CSS 变量读出来，改样式不用改脚本 */
const cardSize = ref(FALLBACK_CARD_SIZE);
const cardGap = ref(FALLBACK_GAP);

/** 实测行距（相邻两行顶边的距离，含行间距） */
const rowHeight = ref(FALLBACK_ROW_HEIGHT);

/**
 * 展开面板的实测高度（含它与上方卡片之间的间距）。
 *
 * 面板滚出渲染窗口后就不在 DOM 里了，spacer 得按它把位置补平，
 * 否则总高度会突然变矮、浏览器把滚动条往回夹——表现为「滚到展开的分组就滚不下去」。
 */
const panelHeight = ref(0);

/**
 * 上一次请求下一页时的条目数。
 *
 * 滚动事件是连续触发的，只靠 loading 挡不住「同一批数据被请求多次」；
 * 条目数变了才允许下一次请求，所以没有更多数据时也不会反复空请求。
 */
let requestedAtCount = -1;

let resizeObserver: ResizeObserver | null = null;
let panelObserver: ResizeObserver | null = null;
let observedPanel: HTMLElement | null = null;
let cardObserver: ResizeObserver | null = null;
let observedCard: HTMLElement | null = null;

/** 上一次展开的面板落在第几行、多高；收起或换分组时用它补偿滚动位置 */
let panelSnapshot = { row: -1, height: 0 };

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

/** 行内格子等宽，卡片在格子里居中——这样整行铺满容器宽度，而不是都挤在左边 */
const rowStyle = computed<CSSProperties>(() => ({
  gridTemplateColumns: `repeat(${columnCount.value}, minmax(0, 1fr))`,
}));

const rowCount = computed(() => Math.ceil(props.items.length / columnCount.value));

/** 视口内第一行（往上留 OVERSCAN_ROWS 行的余量） */
const visibleStartRow = computed(() => Math.max(0, rowAt(scrollTop.value) - OVERSCAN_ROWS));

/** 视口内最后一行（往下留 OVERSCAN_ROWS 行的余量） */
const visibleEndRow = computed(() => {
  const last = rowCount.value - 1;
  if (last < 0) {
    return -1;
  }
  return Math.min(last, rowAt(scrollTop.value + viewportHeight.value) + OVERSCAN_ROWS);
});

/** 真正渲染的行；上下各用一个 spacer 把总高度撑出来 */
const visibleRows = computed<TileRow[]>(() => {
  const rows: TileRow[] = [];
  for (let index = visibleStartRow.value; index <= visibleEndRow.value; index += 1) {
    const items = props.items.slice(index * columnCount.value, (index + 1) * columnCount.value);
    rows.push({
      key: items[0]?.id ?? index,
      items,
      expandedItem: items.find((item) => item.id === props.expandedId) ?? null,
    });
  }
  return rows;
});

/** 展开项落在第几行；没有展开项时为 -1 */
const panelRowIndex = computed(() => {
  if (props.expandedId === null) {
    return -1;
  }
  const index = props.items.findIndex((item) => item.id === props.expandedId);
  return index < 0 ? -1 : Math.floor(index / columnCount.value);
});

// 面板在窗口上方时它没被挂载，那块高度由 top spacer 顶上；在下方时同理
const topSpacerHeight = computed(() => {
  const above = panelRowIndex.value >= 0 && panelRowIndex.value < visibleStartRow.value ? panelHeight.value : 0;
  return visibleStartRow.value * rowHeight.value + above;
});

const bottomSpacerHeight = computed(() => {
  const below = panelRowIndex.value > visibleEndRow.value ? panelHeight.value : 0;
  return Math.max(0, rowCount.value - visibleEndRow.value - 1) * rowHeight.value + below;
});

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

onMounted(() => {
  measure();
  resizeObserver = new ResizeObserver(measure);
  const root = scrollbarRef.value?.$el as HTMLElement | undefined;
  if (root) {
    resizeObserver.observe(root);
  }
  void nextTick(syncCardObserver);
  void nextTick(maybeLoadMore);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  panelObserver?.disconnect();
  panelObserver = null;
  cardObserver?.disconnect();
  cardObserver = null;
});

// ------------------------------------------------------------
// 方法
// ------------------------------------------------------------

// 换了列表（追加或替换）就解禁下一次触底请求，并顺手检查视口是不是还空着
watch(() => props.items, () => {
  requestedAtCount = -1;
  void nextTick(() => {
    measureRowHeight(scrollbarRef.value?.$el as HTMLElement);
    maybeLoadMore();
  });
});

watch(() => props.loading, (loading) => {
  if (!loading) {
    void nextTick(maybeLoadMore);
  }
});

// 换分组或收起时：原来那块面板若在视口上方，它消失会让下面的内容整体上移，
// 这里把滚动位置往回补同样的高度，视口里的内容就不跳（要在快照更新之前建，才能读到上一份）
watch(() => props.expandedId, () => {
  const { row, height } = panelSnapshot;
  if (row < 0 || height === 0 || row >= visibleStartRow.value) {
    return;
  }
  scrollbarRef.value?.setScrollTop(Math.max(0, scrollTop.value - height));
});

watch([panelRowIndex, panelHeight], () => {
  panelSnapshot = { row: panelRowIndex.value, height: panelHeight.value };
});

// 面板换了位置（展开、收起、换分组）就重新找一次元素并量高度；顺手盯住卡片尺寸
watch([visibleRows, () => props.expandedId], () => {
  void nextTick(() => {
    syncPanel();
    syncCardObserver();
  });
}, { flush: 'post' });

/** 一级点封面＝展开；二级（`image`）点封面＝打开查看器 */
function onCoverClick(item: TileItem): void {
  if (props.mode === 'image') {
    emit('open', item);
    return;
  }
  emit('expand', item);
}

function onScroll({ scrollTop: top }: { scrollTop: number }): void {
  scrollTop.value = top;
  maybeLoadMore();
}

/** el-scrollbar 的滚动视口；量高度与判断触底都靠它 */
function viewport(): HTMLElement | undefined {
  return scrollbarRef.value?.wrapRef;
}

/**
 * 内容坐标 → 行号。
 *
 * 展开面板会把它下面的行整体推下去一个面板高度，所以换算要先减掉这一段；
 * 落在面板自己那一段里时算作面板所在的行——面板还看得见，它那一行就不能被卸载。
 * 不减这一段的话，上方有面板时算出来的行号会偏大，最上面几行会被提前丢掉（视口顶部露白）。
 */
function rowAt(y: number): number {
  const panelRow = panelRowIndex.value;
  const panel = panelRow >= 0 ? panelHeight.value : 0;
  if (panel > 0 && y > (panelRow + 1) * rowHeight.value) {
    return Math.max(panelRow, Math.floor((y - panel) / rowHeight.value));
  }
  return Math.floor(y / rowHeight.value);
}

/**
 * 跟着量展开面板的高度。
 *
 * 面板会随「加载更多」长高，所以用 ResizeObserver 盯着；面板被移出渲染窗口后
 * 保留最后一次的高度——spacer 还要用它。
 */
function syncPanel(): void {
  const root = scrollbarRef.value?.$el as HTMLElement | undefined;
  const panel = (root?.querySelector('.tile-panel') as HTMLElement | null) ?? null;
  if (panel === observedPanel) {
    return;
  }
  panelObserver?.disconnect();
  observedPanel = panel;
  if (!panel) {
    panelObserver = null;
    return;
  }

  // 面板高度 = 面板自己的高度 + 它与卡片之间那段间距，都从真实布局上量
  const measurePanel = (): void => {
    const row = panel.parentElement?.querySelector('.tile-row');
    if (!row) {
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    panelHeight.value = panelRect.height + Math.max(0, panelRect.top - rowRect.bottom);
  };
  panelObserver = new ResizeObserver(measurePanel);
  panelObserver.observe(panel);
  measurePanel();
}

/** 量容器：宽度决定列数，高度决定视口里有几行 */
function measure(): void {
  const root = scrollbarRef.value?.$el as HTMLElement | undefined;
  const wrap = viewport();
  if (!root || !wrap) {
    return;
  }
  readSizes(root);
  // 栅格的可用宽度取自行元素（它已经扣掉了内容区的内边距），不是滚动容器的宽度
  const row = root.querySelector<HTMLElement>('.tile-row');
  const available = row ? row.getBoundingClientRect().width : root.clientWidth;
  columnCount.value = Math.max(1, Math.floor((available + cardGap.value) / (cardSize.value + cardGap.value)));
  viewportHeight.value = root.clientHeight;
  scrollTop.value = wrap.scrollTop;
  measureRowHeight(root);
  void nextTick(maybeLoadMore);
}

/** 卡片尺寸与间距读 CSS 变量：将来做「缩略图大小」设置也只改这一个地方 */
function readSizes(root: HTMLElement): void {
  const style = getComputedStyle(root);
  const size = Number.parseFloat(style.getPropertyValue(CARD_SIZE_VAR));
  const gap = Number.parseFloat(style.getPropertyValue(CARD_GAP_VAR));
  if (Number.isFinite(size) && size > 0) {
    cardSize.value = size;
  }
  if (Number.isFinite(gap) && gap >= 0) {
    cardGap.value = gap;
  }
}

/**
 * 盯住卡片本身的尺寸。
 *
 * 容器没变但卡片变了（改样式、将来「缩略图大小」这类设置），
 * 只监听容器是收不到的——卡片的盒子变了才知道要重新量行距与列数。
 */
function syncCardObserver(): void {
  const root = scrollbarRef.value?.$el as HTMLElement | undefined;
  const card = (root?.querySelector('.tile-card') as HTMLElement | null) ?? null;
  if (card === observedCard) {
    return;
  }
  cardObserver?.disconnect();
  observedCard = card;
  if (!card) {
    cardObserver = null;
    return;
  }
  cardObserver = new ResizeObserver(() => {
    measure();
  });
  cardObserver.observe(card);
}

/** 行距＝相邻两行顶边的距离（含行间距）；带面板的那一行不算，它比普通行高一截 */
function measureRowHeight(root: HTMLElement): void {
  const wraps = root.querySelectorAll<HTMLElement>('.tile-row-wrap');
  for (let index = 0; index + 1 < wraps.length; index += 1) {
    if (wraps[index].querySelector('.tile-panel')) {
      continue;
    }
    const pitch = wraps[index + 1].getBoundingClientRect().top - wraps[index].getBoundingClientRect().top;
    if (pitch > 0) {
      rowHeight.value = pitch;
      return;
    }
  }
}

/** 触底且同一批数据没有请求过时才 emit，避免滚动事件把 loadMore 刷屏 */
function maybeLoadMore(): void {
  const wrap = viewport();
  if (props.loading || props.items.length === 0 || !wrap) {
    return;
  }
  if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight > LOAD_MORE_THRESHOLD) {
    return;
  }
  if (requestedAtCount === props.items.length) {
    return;
  }
  requestedAtCount = props.items.length;
  emit('loadMore');
}

/** 页面换筛选 / 切视图时把滚动位置归零 */
function scrollToTop(): void {
  scrollbarRef.value?.setScrollTop(0);
  scrollTop.value = 0;
  requestedAtCount = -1;
}

defineExpose({ scrollToTop });
</script>

<style scoped>
/* 卡片尺寸与间距的唯一来源：脚本读这两个变量算列数，改样式不用动脚本 */
.tile-board {
  --tile-card-size: 100px;
  --tile-gap-x: 20px;
  --tile-gap-y: 24px;
  --tile-panel-max-height: 470px;
  flex: 1;
  min-height: 0;
}

.tile-board :deep(.el-scrollbar__wrap) {
  overflow-x: hidden;
}

.tile-content {
  padding: var(--app-space-2) var(--app-space-8) var(--app-space-8) var(--app-space-8);
}

.tile-row-wrap {
  margin-bottom: 14px;
}

.tile-row {
  display: grid;
  align-items: start;
  justify-items: center;
  column-gap: var(--tile-gap-x);
  row-gap: var(--tile-gap-y);
}

.tile-card {
  position: relative;
  width: 100%;
  max-width: calc(var(--tile-card-size) + 32px);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tile-cover {
  position: relative;
  width: var(--tile-card-size);
  height: var(--tile-card-size);
  cursor: pointer;
}

.tile-cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-6);
  background: var(--app-bg-surface);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

/* 三张封面叠着放：第 0 张在最上面，另外两张往两侧错开并稍作旋转 */
.tile-cover-img.layer-0 {
  z-index: 3;
}

.tile-cover-img.layer-1 {
  z-index: 2;
  transform: rotate(-3.5deg) translate(-3px, 2px) scale(0.97);
}

.tile-cover-img.layer-2 {
  z-index: 1;
  transform: rotate(3.5deg) translate(3px, 2px) scale(0.94);
}

/* 展开：后层张开到与悬停差不多的程度（不放大；放大留给悬停，见下） */
.tile-card.expanded .tile-cover-img.layer-1 {
  transform: rotate(-7deg) translate(-7px, 3px) scale(1);
}

.tile-card.expanded .tile-cover-img.layer-2 {
  transform: rotate(7deg) translate(7px, 3px) scale(0.96);
}

/* 悬停：整张卡抬到邻居之上，三张封面一起放大、各带一层阴影（与查看器底部小图一个观感） */
.tile-cover:hover {
  z-index: 10;
}

.tile-cover:hover .tile-cover-img {
  box-shadow: 0 10px 26px var(--app-shadow-tile);
}

.tile-cover:hover .tile-cover-img.layer-0 {
  transform: scale(1.14);
  box-shadow: 0 12px 30px var(--app-shadow-tile-hover);
}

.tile-cover:hover .tile-cover-img.layer-1 {
  transform: rotate(-8deg) translate(-8px, 3px) scale(1.1);
}

.tile-cover:hover .tile-cover-img.layer-2 {
  transform: rotate(8deg) translate(8px, 3px) scale(1.06);
}

.tile-cover-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--app-border-strong);
  border-radius: var(--app-radius-6);
  background: var(--app-bg-surface);
  color: var(--app-text-faint);
}

.tile-count {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 5;
  min-width: 18px;
  padding: 0 var(--app-space-4);
  border-radius: 9px;
  background: var(--app-overlay-scrim);
  color: var(--app-on-primary);
  font-size: var(--app-font-xs);
  line-height: 18px;
  text-align: center;
}

.tile-check {
  position: absolute;
  top: 2px;
  left: 4px;
  z-index: 5;
  height: auto;
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* 没勾选任何东西时只在悬停的那张卡片上出现；一旦有勾选，所有复选框都常显 */
.tile-cover:hover .tile-check,
.tile-board.selection-active .tile-check {
  opacity: 1;
}

/* 展开了的卡片给一圈主色描边：描边画在最上面那张封面上，跟着它一起缩放与旋转 */
.tile-card.expanded .tile-cover-img.layer-0 {
  outline: 2px solid var(--app-primary);
  outline-offset: 0;
}

.tile-card.expanded .tile-title {
  color: var(--app-accent);
}

.tile-title {
  margin-top: var(--app-space-10);
  max-width: 100%;
  font-size: var(--app-font-sm);
  color: var(--app-text-regular);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-subtitle {
  max-width: 100%;
  font-size: var(--app-font-xs);
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-panel {
  margin-top: var(--app-space-12);
  padding: 14px var(--app-space-16) var(--app-space-16) var(--app-space-16);
  border: 1px solid var(--app-primary);
  border-radius: var(--app-radius-8);
  background: var(--app-bg-selected);
}

.tile-panel-head {
  display: flex;
  align-items: baseline;
  gap: var(--app-space-8);
  margin-bottom: var(--app-space-8);
}

.tile-panel-title {
  font-size: var(--app-font-base);
  font-weight: 600;
  color: var(--app-text-regular);
}

.tile-panel-count {
  font-size: var(--app-font-sm);
  color: var(--app-text-muted);
}

.tile-panel-close {
  margin-left: auto;
  color: var(--app-text-muted);
}

.tile-empty {
  padding: 40px;
  text-align: center;
  color: var(--app-text-faint);
  font-size: var(--app-font-base);
}

.tile-loading {
  padding: var(--app-space-12);
  text-align: center;
  color: var(--app-text-muted);
  font-size: var(--app-font-sm);
}
</style>
