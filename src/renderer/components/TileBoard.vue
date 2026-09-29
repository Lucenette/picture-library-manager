<template>
  <el-scrollbar ref="scrollbarRef" class="tile-board" @scroll="onScroll">
    <div class="tile-content">
      <div v-if="items.length === 0 && !loading" class="tile-empty">暂无数据</div>

      <template v-else>
        <div :style="{ height: topSpacerHeight + 'px' }"></div>

        <div v-for="row in visibleRows" :key="row.key" class="tile-row-wrap">
          <div class="tile-row" :style="rowStyle">
            <div
              v-for="item in row.items"
              :key="item.id"
              class="tile-card"
              :class="{ expanded: item.id === expandedId }"
            >
              <div class="tile-cover" @click="emit('expand', item)">
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
                  class="tile-check"
                  :model-value="selectState(item.id) === 'checked'"
                  :indeterminate="selectState(item.id) === 'indeterminate'"
                  @click.stop
                  @change="emit('select', item)"
                />

                <el-button class="tile-open" size="small" text @click.stop="emit('open', item)">
                  打开全部
                </el-button>
              </div>

              <div class="tile-title" :title="item.title">{{ item.title }}</div>
              <div class="tile-subtitle" :title="item.subtitle">{{ item.subtitle }}</div>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { PictureFilled } from '@element-plus/icons-vue';
import type { ScrollbarInstance } from 'element-plus';
import type { TileItem, TileSelectState } from './TileBoard.types';

/** 卡片封面边长（像素），与缩略图常量一致 */
const CARD_SIZE = 100;

/** 卡片之间的间距，横竖一致；要留得下两张后层封面往两侧探出的部分 */
const CARD_GAP = 18;

/**
 * 行高估算：封面 100 + 标题与副标题两行 + 行间距。
 *
 * 展开面板会撑高它所在的那一行，这个定值与实际高度对不上，所以滚动条的
 * 绝对位置会有偏差——面板打开期间可以接受：没有逐行实测就没有便宜的精确解。
 */
const ROW_HEIGHT = 172;

/** 视口上下各多渲染几行，滚动时不会先露白再补内容 */
const OVERSCAN_ROWS = 2;

/** 展开面板与上方卡片之间的间距；量面板高度时要把它算进去 */
const PANEL_MARGIN = 12;

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
}>(), {
  loading: false,
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

/**
 * 展开面板的实测高度（含 PANEL_MARGIN）。
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
const visibleStartRow = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN_ROWS));

/** 视口内最后一行（往下留 OVERSCAN_ROWS 行的余量） */
const visibleEndRow = computed(() => {
  const last = rowCount.value - 1;
  if (last < 0) {
    return -1;
  }
  return Math.min(last, Math.floor((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN_ROWS);
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
  return visibleStartRow.value * ROW_HEIGHT + above;
});

const bottomSpacerHeight = computed(() => {
  const below = panelRowIndex.value > visibleEndRow.value ? panelHeight.value : 0;
  return Math.max(0, rowCount.value - visibleEndRow.value - 1) * ROW_HEIGHT + below;
});

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

onMounted(() => {
  measure();
  resizeObserver = new ResizeObserver(measure);
  const root = scrollbarRef.value?.$el;
  if (root) {
    resizeObserver.observe(root);
  }
  void nextTick(maybeLoadMore);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  panelObserver?.disconnect();
  panelObserver = null;
});

// ------------------------------------------------------------
// 方法
// ------------------------------------------------------------

// 换了列表（追加或替换）就解禁下一次触底请求，并顺手检查视口是不是还空着
watch(() => props.items, () => {
  requestedAtCount = -1;
  void nextTick(maybeLoadMore);
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

// 面板换了位置（展开、收起、换分组）就重新找一次元素并量高度
watch([visibleRows, () => props.expandedId], () => {
  void nextTick(syncPanel);
}, { flush: 'post' });

function onScroll({ scrollTop: top }: { scrollTop: number }): void {
  scrollTop.value = top;
  maybeLoadMore();
}

/** el-scrollbar 的滚动视口；量高度与判断触底都靠它 */
function viewport(): HTMLElement | undefined {
  return scrollbarRef.value?.wrapRef as HTMLElement | undefined;
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
  panelObserver = new ResizeObserver(() => {
    panelHeight.value = panel.offsetHeight + PANEL_MARGIN;
  });
  panelObserver.observe(panel);
  panelHeight.value = panel.offsetHeight + PANEL_MARGIN;
}

/** 量容器：宽度决定列数，高度决定视口里有几行 */
function measure(): void {
  const root = scrollbarRef.value?.$el;
  const wrap = viewport();
  if (!root || !wrap) {
    return;
  }
  columnCount.value = Math.max(1, Math.floor((root.clientWidth + CARD_GAP) / (CARD_SIZE + CARD_GAP)));
  viewportHeight.value = root.clientHeight;
  scrollTop.value = wrap.scrollTop;
  void nextTick(maybeLoadMore);
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
.tile-board {
  flex: 1;
  min-height: 0;
}

.tile-board :deep(.el-scrollbar__wrap) {
  overflow-x: hidden;
}

.tile-content {
  padding-right: 6px;
}

.tile-row-wrap {
  margin-bottom: 14px;
}

.tile-row {
  display: grid;
  align-items: start;
  justify-items: center;
  gap: 18px;
}

.tile-card {
  position: relative;
  width: 100%;
  max-width: 132px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tile-cover {
  position: relative;
  width: 100px;
  height: 100px;
  cursor: pointer;
}

.tile-cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: 1px solid #3e4044;
  border-radius: 6px;
  background: #2b2d30;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

/* 三张封面叠着放：第 0 张在最上面，另外两张往两侧错开并稍作旋转 */
.tile-cover-img.layer-0 {
  z-index: 3;
}

.tile-cover-img.layer-1 {
  z-index: 2;
  transform: rotate(-4.5deg) translate(-4px, 2px) scale(0.96);
}

.tile-cover-img.layer-2 {
  z-index: 1;
  transform: rotate(4.5deg) translate(4px, 2px) scale(0.92);
}

/* 悬停：整张卡抬到邻居之上，三张封面一起放大、各带一层阴影（与查看器底部小图一个观感） */
.tile-cover:hover {
  z-index: 10;
}

.tile-cover:hover .tile-cover-img {
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.8);
}

.tile-cover:hover .tile-cover-img.layer-0 {
  transform: scale(1.14);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.85);
}

.tile-cover:hover .tile-cover-img.layer-1 {
  transform: rotate(-7deg) translate(-7px, 3px) scale(1.08);
}

.tile-cover:hover .tile-cover-img.layer-2 {
  transform: rotate(7deg) translate(7px, 3px) scale(1.04);
}

.tile-cover-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #3e4044;
  border-radius: 6px;
  background: #2b2d30;
  color: #5e6065;
}

.tile-count {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 5;
  min-width: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.tile-check {
  position: absolute;
  top: 2px;
  left: 4px;
  z-index: 5;
  height: auto;
}

.tile-open {
  position: absolute;
  right: 4px;
  bottom: 4px;
  z-index: 5;
  display: none;
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
}

.tile-cover:hover .tile-open {
  display: block;
}

/* 展开了的卡片给一圈主色描边：描边画在最上面那张封面上，跟着它一起缩放与旋转 */
.tile-card.expanded .tile-cover-img.layer-0 {
  outline: 2px solid #3871e1;
  outline-offset: 0;
}

/* 展开时后层再向外张开一些，比收起状态更明显 */
.tile-card.expanded .tile-cover-img.layer-1 {
  transform: rotate(-9deg) translate(-9px, 4px) scale(1.04);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.7);
}

.tile-card.expanded .tile-cover-img.layer-2 {
  transform: rotate(9deg) translate(9px, 4px) scale(1);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.7);
}

.tile-card.expanded .tile-title {
  color: #7aa2f7;
}

.tile-title {
  margin-top: 4px;
  max-width: 100%;
  font-size: 12px;
  color: #d8dadd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-subtitle {
  max-width: 100%;
  font-size: 11px;
  color: #82858b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-panel {
  margin-top: 12px;
  padding: 10px 12px 12px 12px;
  border: 1px solid #3871e1;
  border-radius: 8px;
  background: #232427;
}

.tile-panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.tile-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #d8dadd;
}

.tile-panel-count {
  font-size: 12px;
  color: #82858b;
}

.tile-panel-close {
  margin-left: auto;
  color: #82858b;
}

.tile-empty {
  padding: 40px;
  text-align: center;
  color: #5e6065;
  font-size: 13px;
}

.tile-loading {
  padding: 12px;
  text-align: center;
  color: #82858b;
  font-size: 12px;
}
</style>
