<template>
  <div ref="rootEl" class="cat-search">
    <div class="search-input-wrap" :class="{ focused: showPanel }">
      <template v-for="tag in activeTags" :key="tag.key">
        <span class="search-tag">
          {{ tag.label }}: {{ tag.display }}
          <span class="tag-x" @click="tag.onClear">×</span>
        </span>
      </template>

      <input
        ref="inputEl"
        v-model="query"
        class="search-input"
        :placeholder="placeholder"
        @focus="open"
        @keydown="onKey"
      />
    </div>

    <div v-if="showPanel" class="search-panel">
      <el-scrollbar ref="scrollRef" max-height="300px">
        <!-- 阶段一：选择筛选维度 -->
        <template v-if="phase === 'category'">
          <div class="section-title">选择筛选条件</div>
          <div
            v-for="category in filteredCategories"
            :key="category.key"
            class="panel-item"
            :class="{ highlighted: selectedIdx === category._idx }"
            @mousedown.prevent="pickCategory(category)"
          >
            <span>{{ category.label }}</span>
            <span class="item-arrow">›</span>
          </div>
          <div v-if="filteredCategories.length === 0" class="panel-empty">所有条件已添加</div>
        </template>

        <!-- 阶段二：选择候选项或自由输入 -->
        <template v-else>
          <div class="section-title">
            <span class="back-btn" @mousedown.prevent="backToCategories">‹ 返回</span>
            <span>{{ activeCategoryLabel }}</span>
          </div>

          <template v-if="isFreeInput">
            <div class="free-hint">输入关键词后按回车确认</div>
            <div v-if="query" class="panel-item" @mousedown.prevent="pickFreeInput">
              <span style="color: var(--app-primary)">使用 "{{ query }}"</span>
            </div>
          </template>

          <template v-else>
            <div
              v-for="item in filteredItems"
              :key="item.value"
              class="panel-item"
              :class="{ highlighted: selectedIdx === item._idx }"
              @mousedown.prevent="pickItem(item)"
            >
              <span>{{ item.label }}</span>
            </div>
            <div v-if="filteredItems.length === 0" class="panel-empty">无匹配</div>
          </template>
        </template>
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { FilterItem, FilterSection } from './CategorySearch.types';

const props = defineProps<{ sections: FilterSection[]; order: string[] }>();

/** 候选维度（附带在当前列表中的下标，供键盘高亮使用） */
type IndexedSection = FilterSection & { _idx: number };

/** 候选项（附带在当前列表中的下标，供键盘高亮使用） */
type IndexedItem = FilterItem & { _idx: number };

const showPanel = ref(false);
const phase = ref<'category' | 'items'>('category');
const activeCategoryKey = ref<string | null>(null);
const query = ref('');
const selectedIdx = ref(0);

const rootEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const scrollRef = ref<{ $el?: HTMLElement } | null>(null);

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

/** 已启用的筛选条件，按启用先后排列 */
const activeTags = computed(() =>
  props.sections
    .filter((section) => section.value)
    .sort((a, b) => props.order.indexOf(a.key) - props.order.indexOf(b.key)),
);

const placeholder = computed(() => (activeTags.value.length ? '继续筛选...' : '点击筛选...'));

/** 尚未启用的筛选维度，输入关键词时按名称过滤 */
const filteredCategories = computed<IndexedSection[]>(() => {
  const keyword = query.value.toLowerCase();
  return props.sections
    .filter((section) => !section.value)
    .map((section, index) => ({ ...section, _idx: index }))
    .filter((section) => !keyword || section.label.toLowerCase().includes(keyword));
});

const activeCategory = computed(() =>
  props.sections.find((section) => section.key === activeCategoryKey.value),
);

const activeCategoryLabel = computed(() => activeCategory.value?.label ?? '');

/** 没有候选项的维度由用户自由输入 */
const isFreeInput = computed(() => activeCategory.value?.items.length === 0);

const filteredItems = computed<IndexedItem[]>(() => {
  const category = activeCategory.value;
  if (!category) {
    return [];
  }

  const keyword = query.value.toLowerCase();
  return category.items
    .filter((item) => !keyword || item.label.toLowerCase().includes(keyword))
    .map((item, index) => ({ ...item, _idx: index }));
});

/** 当前阶段候选项的数量 */
const optionCount = computed(() => {
  if (phase.value === 'category') {
    return filteredCategories.value.length;
  }
  return isFreeInput.value ? 0 : filteredItems.value.length;
});

// ------------------------------------------------------------
// 交互
// ------------------------------------------------------------

function open(): void {
  showPanel.value = true;
  if (!activeCategoryKey.value) {
    phase.value = 'category';
    query.value = '';
  }
  selectedIdx.value = 0;
}

function pickCategory(category: IndexedSection): void {
  activeCategoryKey.value = category.key;
  phase.value = 'items';
  query.value = '';
  selectedIdx.value = 0;
}

function pickItem(item: FilterItem): void {
  activeCategory.value?.onSelect(item.value);
  resetSelection();
}

function pickFreeInput(): void {
  const keyword = query.value.trim();
  if (!activeCategory.value || !keyword) {
    return;
  }

  activeCategory.value.onSelect(keyword);
  resetSelection();
}

function backToCategories(): void {
  phase.value = 'category';
  activeCategoryKey.value = null;
  query.value = '';
  selectedIdx.value = 0;
}

function resetSelection(): void {
  activeCategoryKey.value = null;
  phase.value = 'category';
  query.value = '';
  selectedIdx.value = 0;
}

/** 回车时激活当前高亮的候选项 */
function activateOption(index: number): void {
  if (phase.value === 'category') {
    const category = filteredCategories.value[index];
    if (category) {
      pickCategory(category);
    }
    return;
  }

  const item = filteredItems.value[index];
  if (item) {
    pickItem(item);
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (phase.value === 'items') {
      backToCategories();
    } else {
      showPanel.value = false;
      inputEl.value?.blur();
    }
    return;
  }

  // 输入为空时退格删除最后一个筛选项
  if (event.key === 'Backspace' && !query.value && activeTags.value.length) {
    activeTags.value[activeTags.value.length - 1].onClear();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectedIdx.value = Math.min(selectedIdx.value + 1, optionCount.value - 1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    if (phase.value === 'items' && isFreeInput.value) {
      pickFreeInput();
      return;
    }

    const target = Math.min(selectedIdx.value, optionCount.value - 1);
    if (target < 0) {
      return;
    }
    selectedIdx.value = 0;
    activateOption(target);
  }
}

/** 键盘移动高亮时把对应项滚动到可视区域 */
watch(selectedIdx, () => {
  void nextTick(() => {
    const wrap = scrollRef.value?.$el?.querySelector('.el-scrollbar__wrap');
    if (!wrap) {
      return;
    }

    const element = wrap.querySelectorAll('.panel-item')[selectedIdx.value] as HTMLElement | undefined;
    if (!element) {
      return;
    }

    const wrapRect = wrap.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    if (elementRect.bottom > wrapRect.bottom) {
      wrap.scrollTop += elementRect.bottom - wrapRect.bottom + 4;
    }
    if (elementRect.top < wrapRect.top) {
      wrap.scrollTop -= wrapRect.top - elementRect.top + 4;
    }
  });
});

function onClickOutside(event: MouseEvent): void {
  if (rootEl.value && !rootEl.value.contains(event.target as Node)) {
    showPanel.value = false;
  }
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>

<style scoped>
.cat-search {
  position: relative;
  flex: 1;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-strong);
  transition: border-color 0.15s;
  min-height: 32px;
}

.search-input-wrap.focused {
  border-color: var(--app-primary);
}

.search-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--app-bg-highlight);
  border: 1px solid var(--app-border-highlight);
  color: var(--app-primary);
  font-size: 12px;
  white-space: nowrap;
}

.tag-x {
  cursor: pointer;
  opacity: 0.6;
}

.tag-x:hover {
  opacity: 1;
  color: var(--app-danger);
}

.search-input {
  flex: 1;
  min-width: 80px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--app-text-regular);
  font-size: 13px;
  padding: 2px 4px;
}

.search-input::placeholder {
  color: var(--app-text-muted);
}

.search-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 20;
  margin-top: 4px;
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px var(--app-shadow-popup);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 4px;
  font-size: 11px;
  color: var(--app-text-disabled);
}

.back-btn {
  cursor: pointer;
  color: var(--app-primary);
}

.back-btn:hover {
  opacity: 0.8;
}

.panel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--app-text-regular);
}

.panel-item:hover {
  background: var(--app-bg-hover);
}

.panel-item.highlighted {
  background: var(--app-bg-hover);
  color: var(--app-primary);
}

.item-arrow {
  color: var(--app-text-faint);
  font-size: 14px;
}

.panel-empty {
  padding: 16px;
  text-align: center;
  color: var(--app-text-faint);
  font-size: 13px;
}

.free-hint {
  padding: 10px 12px 4px;
  font-size: 12px;
  color: var(--app-text-muted);
}
</style>
