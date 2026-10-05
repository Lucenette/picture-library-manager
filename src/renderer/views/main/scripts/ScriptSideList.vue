<template>
  <div class="script-side">
    <div class="side-head" :class="{ 'is-searching': searching }">
      <!-- 表头那一排控件：展开搜索框时整条收掉（宽度与透明度一起过渡） -->
      <div class="head-bar">
        <button ref="filterEl" type="button" class="filter-btn" @click="openFilter">
          <span class="filter-label">{{ filterLabel }}</span>
          <span class="filter-arrow">▾</span>
        </button>

        <el-tooltip content="搜索脚本" placement="bottom" :show-after="300">
          <el-button text class="icon-btn" :icon="Search" @click="startSearch" />
        </el-tooltip>
        <el-tooltip content="新建分组" placement="bottom" :show-after="300">
          <el-button text class="icon-btn" :icon="FolderAdd" @click="emit('group-new')" />
        </el-tooltip>
      </div>

      <!-- 搜索框：点搜索按钮从 0 宽展开过来，输入即过滤。失焦时有内容就留着、空的就收，
           点清空那个叉号或按 Esc 都清空并收起 -->
      <el-input
        ref="searchEl"
        v-model="keyword"
        class="search-input"
        placeholder="搜索脚本"
        clearable
        @keydown.esc="endSearch"
        @blur="onSearchBlur"
        @clear="endSearch"
      />
    </div>

    <el-scrollbar class="side-list">
      <!-- 一个分组一段：整段都是「拖脚本进来」的落点，高亮也就加在段上 -->
      <section
        v-for="group in groups"
        :key="group.key"
        class="group-section"
        :class="{ 'is-drop-target': dropTargetKey === group.key }"
        @dragover.prevent="onGroupDragOver(group)"
        @drop.prevent="onGroupDrop(group)"
      >
        <div class="group-head" @contextmenu.prevent="onGroupContextMenu(group.id)">
          <button type="button" class="group-toggle" @click="emit('group-toggle', group.id)">
            <el-icon class="group-icon">
              <component :is="isCollapsed(group) ? Folder : FolderOpened" />
            </el-icon>
            <span class="group-name">{{ group.name }}</span>
            <span class="group-count">({{ countOf(group) }})</span>
          </button>

          <!-- 每个分组自己的动作：悬停或键盘进入时才露出来 -->
          <div class="group-actions">
            <el-tooltip content="新增脚本" placement="bottom" :show-after="300">
              <el-button text class="icon-btn" :icon="Plus" @click="emit('create', group.id)" />
            </el-tooltip>
            <el-tooltip content="加载文件" placement="bottom" :show-after="300">
              <el-button text class="icon-btn" :icon="FolderOpened" @click="emit('import', group.id)" />
            </el-tooltip>
          </div>
        </div>

        <template v-if="!isCollapsed(group)">
          <button
            v-for="item in visibleOf(group)"
            :key="item.key"
            type="button"
            class="side-item"
            :class="[`is-${item.state}`, { active: item.key === activeKey }]"
            draggable="true"
            @click="emit('select', item.key)"
            @contextmenu.prevent="emit('menu', item.key)"
            @dragstart="onItemDragStart($event, item.key)"
            @dragend="onItemDragEnd"
          >
            <span class="side-name">{{ item.name }}</span>
          </button>
        </template>
      </section>

      <p v-if="visibleCount === 0" class="side-empty">没有符合条件的脚本</p>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { Folder, FolderAdd, FolderOpened, Plus, Search } from '@element-plus/icons-vue';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { InputInstance } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { ScriptType, TypeFilterOpenData } from '@common/types';

import { TYPE_LABELS, type ScriptGroupView, type SideItem } from './script-list';

/** 过滤取值：三种已知类型 + 「一个类型都没识别到」 */
type FilterValue = ScriptType | 'unknown';

const FILTER_OPTIONS: { value: FilterValue; label: string }[] = [
  { value: 'select-image', label: TYPE_LABELS['select-image'] },
  { value: 'identify-character', label: TYPE_LABELS['identify-character'] },
  { value: 'identify-structure', label: TYPE_LABELS['identify-structure'] },
  // 一个方法都没识别到的脚本也要能被看到，否则它只会在筛选里静静消失
  { value: 'unknown', label: '未识别' },
];

const props = defineProps<{
  /** 一段一段的分组；顺序由页面排好（字典序，未分组在最后），这里只管渲染与筛选 */
  groups: ScriptGroupView[];
  activeKey: string;
}>();

const emit = defineEmits<{
  (event: 'select', key: string): void;
  /** 在某个分组里新建脚本；null = 未分组 */
  (event: 'create', groupId: number | null): void;
  /** 往某个分组里加载文件；null = 未分组 */
  (event: 'import', groupId: number | null): void;
  /** 右键某一项：原生菜单由主进程弹，这里只报是哪一项 */
  (event: 'menu', key: string): void;
  /** 顶栏的「新建分组」 */
  (event: 'group-new'): void;
  /** 右键某个分组的头；「未分组」不弹 */
  (event: 'group-menu', groupId: number): void;
  (event: 'group-toggle', groupId: number | null): void;
  /** 把某一项拖进了某个分组；null = 未分组 */
  (event: 'script-move', key: string, groupId: number | null): void;
}>();

/** 默认全选：不筛就是全部 */
const selected = ref<FilterValue[]>(FILTER_OPTIONS.map((option) => option.value));
/** 过滤触发按钮：浮窗要按它的位置定位 */
const filterEl = ref<HTMLElement | null>(null);
/** 浮窗回发的订阅：浮窗是复用的，每次打开前先摘掉上一次那个 */
let filterListener: ((event: IpcRendererEvent, selected: string[]) => void) | null = null;
/** 搜索框：点搜索按钮才展开，输入即过滤（脚本名或分组名，不区分大小写） */
const searching = ref(false);
const keyword = ref('');
const searchEl = ref<InputInstance | null>(null);
/** 正被拖着的那一项，以及它悬停到的分组：都只是这次拖拽的临时状态 */
const draggingKey = ref<string | null>(null);
const dropTargetKey = ref<string | null>(null);

/**
 * 触发按钮上那一行：部分勾选时把名字用「、」连起来（Steam 那个下拉就是这么写的），
 * 全勾时写「全部类型」——四个名字在 220px 里只会被截成「图片、角…」。
 */
const filterLabel = computed(() => {
  if (selected.value.length === FILTER_OPTIONS.length) {
    return '全部类型';
  }
  if (selected.value.length === 0) {
    return '未选择类型';
  }
  return FILTER_OPTIONS.filter((option) => selected.value.includes(option.value))
    .map((option) => option.label)
    .join('、');
});

/** 类型筛选不是全选，或者搜索框里有内容：计数这时显示「可见/总数」 */
const filterActive = computed(
  () => selected.value.length !== FILTER_OPTIONS.length || keyword.value.trim() !== '',
);

/** 搜索词：去空白并小写，匹配时用它 */
const query = computed(() => keyword.value.trim().toLowerCase());

/** 整张列表里可见的条目数：一个都没有时才给那行提示 */
const visibleCount = computed(
  () => props.groups.reduce((sum, group) => sum + visibleOf(group).length, 0),
);

onBeforeUnmount(() => {
  if (filterListener !== null) {
    ipcRenderer.removeListener(IPC.TYPE_FILTER_CHANGED, filterListener);
    filterListener = null;
  }
  setNativeDragAcceptance(false);
});

/** 展开搜索框并把焦点打进去 */
function startSearch(): void {
  searching.value = true;
  void nextTick(() => searchEl.value?.focus());
}

/** 清空并收起搜索框（Esc / 点清空叉号）：留着关键字却把框收起来，就成了看不见的过滤条件 */
function endSearch(): void {
  keyword.value = '';
  searching.value = false;
}

/** 失焦：有内容就留着（可能还要接着看结果），空着就收回去 */
function onSearchBlur(): void {
  if (keyword.value === '') {
    endSearch();
  }
}

/**
 * 打开类型过滤浮窗：与脚本下拉是同一个原生浮窗，只是内容换成多选。
 *
 * 勾选结果由 TYPE_FILTER_CHANGED 持续回发，窗口不收起——点到别处失焦或按 Esc 时才收。
 */
function openFilter(): void {
  const rect = filterEl.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }

  if (filterListener !== null) {
    ipcRenderer.removeListener(IPC.TYPE_FILTER_CHANGED, filterListener);
  }
  filterListener = (_event: IpcRendererEvent, next: string[]) => {
    selected.value = next.filter((value): value is FilterValue => (
      FILTER_OPTIONS.some((option) => option.value === value)
    ));
  };
  ipcRenderer.on(IPC.TYPE_FILTER_CHANGED, filterListener);

  const data: TypeFilterOpenData = {
    options: FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    selected: [...selected.value],
    controlRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    listHeight: FILTER_OPTIONS.length * 32,
  };
  void ipcRenderer.invoke(IPC.TYPE_FILTER_OPEN, data);
}

/** 草稿的类型未知（见 SideItem），不参与过滤：否则刚新建一个脚本就会被筛没 */
function matchesFilter(types: ScriptType[]): boolean {
  if (types.length === 0) {
    return selected.value.includes('unknown');
  }
  return types.some((type) => selected.value.includes(type));
}

/**
 * 搜索命中：**脚本名或它所属分组的名**里含这个子串（不区分大小写）。
 *
 * 判据照 DSH 的会话搜索（它匹配会话标题与所属工作区的名字）；不做正文搜索——
 * 那要读每个脚本文件，是另一个量级的活。
 */
function matchesKeyword(group: ScriptGroupView, item: SideItem): boolean {
  if (query.value === '') {
    return true;
  }
  return item.name.toLowerCase().includes(query.value) || group.name.toLowerCase().includes(query.value);
}

/** 一个分组里可见的条目：类型筛选与搜索都通过才算 */
function visibleOf(group: ScriptGroupView): SideItem[] {
  return group.items.filter(
    (item) => (item.state === 'new' || matchesFilter(item.types)) && matchesKeyword(group, item),
  );
}

/** 这一个分组此刻折不折：搜索命中的分组临时展开——折叠状态本身不动，清空搜索就回到原样 */
function isCollapsed(group: ScriptGroupView): boolean {
  if (!group.collapsed) {
    return false;
  }
  return !(query.value !== '' && visibleOf(group).length > 0);
}

/** 组头的计数：没筛选就是总数，筛了就是「可见/总数」 */
function countOf(group: ScriptGroupView): string {
  return filterActive.value ? `${visibleOf(group).length}/${group.items.length}` : `${group.items.length}`;
}

/** 右键分组头：「未分组」不能改名也不能删，所以它不弹菜单 */
function onGroupContextMenu(groupId: number | null): void {
  if (groupId === null) {
    return;
  }
  emit('group-menu', groupId);
}

// ------------------------------------------------------------
// 拖拽：只用来换分组
// ------------------------------------------------------------

function acceptDrag(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function acceptDrop(event: DragEvent): void {
  event.preventDefault();
}

/**
 * 拖动期间在 document 上放行落点（照 DSH 的 useNativeDragAcceptance）。
 *
 * 落点只在分组段上，光标一旦移到列表外就会显示成「禁止」，看起来像要丢件；在 document 上
 * preventDefault 之后，松手在哪儿都不会出现那个光标，也不会丢掉最后一次落点。
 */
function setNativeDragAcceptance(active: boolean): void {
  if (active) {
    document.addEventListener('dragover', acceptDrag);
    document.addEventListener('drop', acceptDrop);
    return;
  }
  document.removeEventListener('dragover', acceptDrag);
  document.removeEventListener('drop', acceptDrop);
}

function onItemDragStart(event: DragEvent, key: string): void {
  draggingKey.value = key;
  dropTargetKey.value = null;
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  }
  setNativeDragAcceptance(true);
}

/** 悬停到某个分组段上：它就是落点（落下只改归属，所以不区分上下半区） */
function onGroupDragOver(group: ScriptGroupView): void {
  if (draggingKey.value === null) {
    return;
  }
  dropTargetKey.value = group.key;
}

function onGroupDrop(group: ScriptGroupView): void {
  const key = draggingKey.value;
  onItemDragEnd();
  if (key === null) {
    return;
  }
  emit('script-move', key, group.id);
}

/** 拖拽结束（含拖到窗口外松手）：清掉全部临时状态并摘掉 document 上的监听 */
function onItemDragEnd(): void {
  draggingKey.value = null;
  dropTargetKey.value = null;
  setNativeDragAcceptance(false);
}
</script>

<style scoped>
.script-side {
  display: flex;
  flex-direction: column;
  flex: none;
  padding: 0;
  width: 300px;
  min-height: 0;
  border-right: 2px solid var(--el-fill-color-light);
}

/* 表头就是这一行控件：内边距跟着 .script-side 的 --page-padding 走。
   这里刻意不写 gap：左排与搜索框是互补的（一个收到 0、一个从 0 撑开），
   而 gap 对 0 宽的子项照样生效，留出的一侧空白就是这么来的 */
.side-head {
  display: flex;
  align-items: center;
  padding: var(--page-padding);
  padding-bottom: var(--app-space-16);
}

/* 表头那一排控件：展开搜索框时整条收紧到 0。
   宽度与透明度一起过渡——DSH 的 sectionLabel / headerActions 用的也是 max-width + opacity 这一套 */
.head-bar {
  display: flex;
  align-items: center;
  gap: var(--app-space-10);
  flex: 1;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  opacity: 1;
  transition: max-width 0.18s ease, opacity 0.12s ease;
}

.side-head.is-searching .head-bar {
  max-width: 0;
  opacity: 0;
  pointer-events: none;
}

/* 搜索框：从 0 宽展开到占满这一行（与过滤控件同高） */
.search-input {
  flex: 1;
  min-width: 0;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transition: max-width 0.18s ease, opacity 0.12s ease;
}

.side-head.is-searching .search-input {
  max-width: 100%;
  opacity: 1;
}

/* 纯图标按钮：无边框、方角（EP 默认的 --el-border-radius-base = 4px）；
   字号 16px，图标随字号缩放，和左侧导航栏的图标一样大 */
.icon-btn {
  padding: 0;
  border-radius: var(--el-border-radius-base);
  font-size: var(--app-font-lg);
  color: var(--el-text-color-secondary);

  &:hover {
    color: var(--el-text-color-regular);
    background: inherit !important;
  }
}

/* 自己画的控件也要长得像输入框：照 theme.css 里 .el-input__wrapper 的那套规格 */
.filter-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-space-6);
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 11px;
  border: none;
  border-radius: var(--app-radius-4);
  background: var(--app-bg-surface);
  box-shadow: 0 0 0 1px var(--app-border) inset;
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-base);
  cursor: pointer;
}

.filter-btn:hover {
  box-shadow: 0 0 0 1px var(--app-border-strong) inset;
}

.filter-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.filter-arrow {
  flex: none;
  color: var(--app-text-muted);
  font-size: var(--app-font-xs);
}

.side-list {
  flex: 1;
  min-height: 0;
}

/* 内边距放在内容层：EP 的滚动条要贴着自己那一层，别被内边距推开。上下不加——
   上面那行表头已经让出过间距了（与 .side-head 的 --page-padding 对齐） */
.side-list :deep(.el-scrollbar__view) {
  padding: 0 var(--page-gap);
}

/* 段间距 4px、段内行距 2px：与 DSH 的 `.groupSection + .groupSection` / `.groupSection > * + *`
   同一条规则。高亮背景因此是 32px/34px 一个独立的圆角块，不会和邻行连成一片 */
.side-list :deep(.el-scrollbar__view) > * + * {
  margin-top: var(--app-space-4);
}

.group-section > * + * {
  margin-top: var(--app-space-2);
}

/* 拖脚本时悬停到的分组：整段亮一下（落下只改归属，所以没有"插到某两行之间"的落点线） */
.group-section.is-drop-target {
  border-radius: var(--el-border-radius-base);
  background: var(--app-bg-header);
  box-shadow: inset 0 0 0 1px var(--app-border-strong);
}

.group-head {
  display: flex;
  align-items: center;
  gap: var(--app-space-6);
  width: 100%;
  height: 34px;
  padding: 0 var(--app-space-8) 0 var(--app-space-12);
  border-radius: var(--el-border-radius-base);
}

/* 组头也要有悬停底色（DSH 那边 projectRow 与 sessionRow 是同一条 hover 规则），
   底色与脚本项一致，形状也跟着项的圆角 */
.group-head:hover {
  background: var(--app-bg-surface);
}

/* 折叠开关：图标 + 组名 + 计数，占满剩下的宽度 */
.group-toggle {
  display: flex;
  align-items: center;
  gap: var(--app-space-6);
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--el-text-color-secondary);
  font-size: var(--app-font-base);
  text-align: left;
  cursor: pointer;
}

.group-toggle:hover {
  color: var(--el-text-color-regular);
}

/* 每个分组自己的动作：平时藏着但占位仍在（悬停时不整行跳动），
   鼠标悬停或键盘聚焦才露出来 */
.group-actions {
  display: flex;
  align-items: center;
  gap: var(--app-space-8);
  flex: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s;
}

.group-head:hover .group-actions,
.group-head:focus-within .group-actions {
  opacity: 1;
  visibility: visible;
}

.group-actions .el-button + .el-button {
  margin-left: 0;
}

/* 组图标：折叠是合着的文件夹、展开是打开的文件夹（接替原来那个 ▾，色不变） */
.group-icon {
  flex: none;
  color: var(--app-text-muted);
  font-size: var(--app-font-lg);
}

/* 名称按内容宽：后面的计数直接跟在它后面（不再被顶到最右）。名字太长时才由它自己省略 */
.group-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.group-count {
  flex: none;
  color: var(--app-text-muted);
}

/* 缩进对齐组名：组名在 12（内边距）+ 16（文件夹图标）+ 6（间隙）= 34px */
.side-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: var(--app-space-8) var(--app-space-12) var(--app-space-8) 34px;
  border: none;
  border-radius: var(--el-border-radius-base);
  background: none;
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-base);
  text-align: left;
  cursor: pointer;
}

.side-item:hover {
  background: var(--app-bg-surface);
}

/* 选中态：一块圆角底色 + 提亮（与悬停同一块底色，只是文字更亮） */
.side-item.active {
  background: var(--app-bg-surface);
  color: var(--app-text-regular);
}

/* 未保存：新建的绿、改动的蓝，同 IDEA 的 git 状态色 */
.side-item.is-new .side-name {
  color: var(--el-color-success);
}

.side-item.is-modified .side-name {
  color: var(--el-color-primary);
}

.side-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.side-empty {
  padding: var(--app-space-8) var(--app-space-12) var(--app-space-8) 34px;
  color: var(--app-text-muted);
  font-size: var(--app-font-base);
}
</style>
