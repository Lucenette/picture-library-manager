<template>
  <div class="script-side">
    <div class="side-head">
      <button ref="filterEl" type="button" class="filter-btn" @click="openFilter">
        <span class="filter-label">{{ filterLabel }}</span>
        <span class="filter-arrow">▾</span>
      </button>

      <el-tooltip content="新增脚本" placement="bottom" :show-after="300">
        <el-button text class="icon-btn" :icon="Plus" @click="emit('create')" />
      </el-tooltip>
      <el-tooltip content="加载文件" placement="bottom" :show-after="300">
        <el-button text class="icon-btn" :icon="FolderOpened" @click="emit('import')" />
      </el-tooltip>
    </div>

    <div class="side-list">
      <!-- 分组现在只是外观：只有一组，将来真做分组时这里换成 v-for -->
      <button type="button" class="group-head" @click="collapsed = !collapsed">
        <span class="group-caret" :class="{ 'is-collapsed': collapsed }">▾</span>
        <span class="group-name">未分组</span>
        <span class="group-count">({{ visibleItems.length }})</span>
      </button>

      <template v-if="!collapsed">
        <button
          v-for="item in visibleItems"
          :key="item.key"
          type="button"
          class="side-item"
          :class="[`is-${item.state}`, { active: item.key === activeKey }]"
          @click="emit('select', item.key)"
          @contextmenu.prevent="emit('menu', item.key)"
        >
          <span class="side-name">{{ item.name }}</span>
        </button>
        <p v-if="visibleItems.length === 0" class="side-empty">没有符合筛选的脚本</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { FolderOpened, Plus } from '@element-plus/icons-vue';
import { IPC } from '@common/ipcChannels';
import type { ScriptType, TypeFilterOpenData } from '@common/types';
import { TYPE_LABELS, type SideItem } from './script-list';

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
  /** 状态用名字颜色表示，照 IDEA 的 git 状态色：新建未保存绿、改过未保存蓝、干净默认色 */
  items: SideItem[];
  activeKey: string;
}>();

const emit = defineEmits<{
  (event: 'select', key: string): void;
  (event: 'create'): void;
  (event: 'import'): void;
  /** 右键某一项：原生菜单由主进程弹，这里只报是哪一项 */
  (event: 'menu', key: string): void;
}>();

/** 默认全选：不筛就是全部 */
const selected = ref<FilterValue[]>(FILTER_OPTIONS.map((option) => option.value));
const collapsed = ref(false);
/** 过滤触发按钮：浮窗要按它的位置定位 */
const filterEl = ref<HTMLElement | null>(null);
/** 浮窗回发的订阅：浮窗是复用的，每次打开前先摘掉上一次那个 */
let filterListener: ((event: IpcRendererEvent, selected: string[]) => void) | null = null;

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

/** 过滤后的列表 */
const visibleItems = computed(
  () => props.items.filter((item) => item.state === 'new' || matchesFilter(item.types)),
);

onBeforeUnmount(() => {
  if (filterListener !== null) {
    ipcRenderer.removeListener(IPC.TYPE_FILTER_CHANGED, filterListener);
    filterListener = null;
  }
});

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

/* 表头就是这一行控件：内边距跟着 .script-side 的 --page-padding 走 */
.side-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--page-padding);
}

.side-head .el-button + .el-button {
  margin-left: 0;
}

/* 纯图标按钮：无边框、方角（EP 默认的 --el-border-radius-base = 4px）、32px 见方——
   与过滤控件、右栏输入框同高；字号提到 16px，图标随字号缩放，和左侧导航栏的图标一样大 */
.side-head .icon-btn {
  padding: 0;
  border-radius: var(--el-border-radius-base);
  font-size: 16px;
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
  gap: 6px;
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 11px;
  border: none;
  border-radius: 4px;
  background: #2b2d30;
  box-shadow: 0 0 0 1px #323438 inset;
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-base);
  cursor: pointer;
}

.filter-btn:hover {
  box-shadow: 0 0 0 1px #3e4044 inset;
}

.filter-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.filter-arrow {
  flex: none;
  color: #82858b;
  font-size: 11px;
}

.side-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--page-padding);
  padding-top: 10px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.group-head:hover {
  color: var(--el-text-color-regular);
}

.group-caret {
  flex: none;
  width: 12px;
  color: #82858b;
  font-size: 11px;
  text-align: center;
  transition: transform 0.15s;
}

.group-caret.is-collapsed {
  transform: rotate(-90deg);
}

.group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.group-count {
  color: #82858b;
}

/* 缩进对齐组名：组名在 12 + 12(三角) + 6(间隙) = 30px，这里 2px 竖条 + 28px 内边距同样落到 30px */
.side-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 12px 8px 28px;
  border: none;
  border-radius: var(--el-border-radius-base);
  background: none;
  color: var(--el-text-color-regular);
  font-size: var(--el-font-size-base);
  text-align: left;
  cursor: pointer;
}

.side-item:hover {
  background: #2b2d30;
}

/* 选中态与左侧导航栏同一套：一道竖条 + 提亮 */
.side-item.active {
  border-left-color: var(--el-color-primary);
  background: #2b2d30;
  color: #d8dadd;
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
  padding: 8px 12px 8px 28px;
  color: #82858b;
  font-size: 13px;
}
</style>
