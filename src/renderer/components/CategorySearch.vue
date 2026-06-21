<template>
  <div class="cat-search" ref="rootEl">
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
      <!-- 阶段1：选分类（支持打字搜索） -->
      <template v-if="phase === 'category'">
        <div class="section-title">选择筛选条件</div>
        <div
          v-for="cat in filteredCats"
          :key="cat.key"
          class="panel-item"
          :class="{ highlighted: highlightedIdx === cat._idx }"
          @mousedown.prevent="pickCategory(cat)"
        >
          <span>{{ cat.label }}</span>
          <span class="item-arrow">›</span>
        </div>
        <div v-if="filteredCats.length === 0" class="panel-empty">所有条件已添加</div>
      </template>
      <!-- 阶段2：自由输入或选值 -->
      <template v-else>
        <div class="section-title">
          <span class="back-btn" @mousedown.prevent="phase = 'category'; selectedIdx = 0; query = '';">‹ 返回</span>
          <span>{{ activeCatLabel }}</span>
        </div>
        <template v-if="isFreeInput">
          <div class="free-hint">输入关键词后按回车确认</div>
          <div v-if="query" class="panel-item" @mousedown.prevent="pickFreeInput()">
            <span style="color: #3871e1">使用 "{{ query }}"</span>
          </div>
        </template>
        <template v-else>
          <div
            v-for="item in filteredItems"
            :key="item.value"
            class="panel-item"
            :class="{ highlighted: highlightedIdx === item._idx }"
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
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { FilterSection, FilterItem } from './CategorySearch.types';

const props = defineProps<{ sections: FilterSection[]; order: string[] }>();

const showPanel = ref(false);
const phase = ref<'category' | 'items'>('category');
const activeCatKey = ref<string | null>(null);
const query = ref('');
const rootEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const selectedIdx = ref(0);
const scrollRef = ref<any>(null);

// 键盘导航时自动滚动到高亮项
watch(selectedIdx, () => {
  nextTick(() => {
    const wrap = scrollRef.value?.$el?.querySelector('.el-scrollbar__wrap');
    if (!wrap) return;
    const items = wrap.querySelectorAll('.panel-item');
    const el = items[selectedIdx.value] as HTMLElement;
    if (!el) return;
    const wrapRect = wrap.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.bottom > wrapRect.bottom) wrap.scrollTop += elRect.bottom - wrapRect.bottom + 4;
    if (elRect.top < wrapRect.top) wrap.scrollTop -= wrapRect.top - elRect.top + 4;
  });
});

const activeTags = computed(() => {
  const tags = props.sections.filter(s => s.value);
  return tags.sort((a, b) => props.order.indexOf(a.key) - props.order.indexOf(b.key));
});
const placeholder = computed(() => activeTags.value.length ? '继续筛选...' : '点击筛选...');

const filteredCats = computed(() => {
  const q = query.value.toLowerCase();
  const cats = props.sections
    .filter(s => !s.value)
    .map((s, i) => ({ ...s, _idx: i }));
  if (!q) return cats;
  return cats.filter(c => c.label.toLowerCase().includes(q));
});

const activeCatLabel = computed(() => props.sections.find(s => s.key === activeCatKey.value)?.label || '');
const activeCat = computed(() => props.sections.find(s => s.key === activeCatKey.value));
const isFreeInput = computed(() => activeCat.value?.items.length === 0);

const filteredItems = computed(() => {
  const cat = activeCat.value;
  if (!cat) return [];
  const q = query.value.toLowerCase();
  if (!q) return cat.items.map((item, i) => ({ ...item, _idx: i }));
  return cat.items
    .filter(item => item.label.toLowerCase().includes(q))
    .map((item, i) => ({ ...item, _idx: i }));
});

const highlightedIdx = computed(() => selectedIdx.value);

function open(): void {
  showPanel.value = true;
  if (!activeCatKey.value) { phase.value = 'category'; query.value = ''; }
  selectedIdx.value = 0;
}

function pickCategory(cat: FilterSection & { _idx: number }): void {
  activeCatKey.value = cat.key;
  phase.value = 'items';
  query.value = '';
  selectedIdx.value = 0;
}

function pickItem(item: FilterItem): void {
  const cat = activeCat.value;
  if (!cat) return;
  cat.onSelect(item.value);
  reset();
}

function pickFreeInput(): void {
  const cat = activeCat.value;
  if (!cat || !query.value.trim()) return;
  cat.onSelect(query.value.trim());
  reset();
}

function reset(): void {
  activeCatKey.value = null;
  phase.value = 'category';
  query.value = '';
  selectedIdx.value = 0;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (phase.value === 'items') { phase.value = 'category'; activeCatKey.value = null; query.value = ''; selectedIdx.value = 0; }
    else { showPanel.value = false; inputEl.value?.blur(); }
    return;
  }
  if (e.key === 'Backspace' && !query.value && activeTags.value.length) {
    const last = activeTags.value[activeTags.value.length - 1];
    last.onClear();
    return;
  }
  const list = phase.value === 'category'
    ? filteredCats.value as any[]
    : (!isFreeInput.value ? filteredItems.value as any[] : []);
  if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx.value = Math.min(selectedIdx.value + 1, list.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx.value = Math.max(selectedIdx.value - 1, 0); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (phase.value === 'items' && isFreeInput.value) { pickFreeInput(); return; }
    const idx = Math.min(selectedIdx.value, list.length - 1);
    const item = list[idx];
    if (!item) return;
    selectedIdx.value = 0;
    if (phase.value === 'category') pickCategory(item);
    else pickItem(item);
  }
}

function onClickOutside(e: MouseEvent): void {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) showPanel.value = false;
}

onMounted(() => document.addEventListener('click', onClickOutside));
onUnmounted(() => document.removeEventListener('click', onClickOutside));
</script>

<style scoped>
.cat-search { position: relative; flex: 1; }
.search-input-wrap {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  padding: 4px 8px; border-radius: 8px;
  background: #2b2d30; border: 1px solid #3e4044;
  transition: border-color 0.15s; min-height: 32px;
}
.search-input-wrap.focused { border-color: #3871e1; }
.search-tag {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 4px;
  background: #1e2e45; border: 1px solid #2859b8;
  color: #3871e1; font-size: 12px; white-space: nowrap;
}
.tag-x { cursor: pointer; opacity: 0.6; }
.tag-x:hover { opacity: 1; color: #c75458; }
.search-input {
  flex: 1; min-width: 80px; border: none; outline: none;
  background: transparent; color: #d8dadd; font-size: 13px; padding: 2px 4px;
}
.search-input::placeholder { color: #82858b; }
.search-panel {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 20;
  margin-top: 4px; background: #2b2d30; border: 1px solid #323438;
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.section-title {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px 4px; font-size: 11px; color: #6e7177;
  text-transform: uppercase; letter-spacing: 0;
}
.back-btn { cursor: pointer; color: #3871e1; text-transform: none; }
.back-btn:hover { opacity: 0.8; }
.panel-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 12px; cursor: pointer; font-size: 13px; color: #d8dadd;
}
.panel-item:hover { background: #2e3034; }
.panel-item.highlighted { background: #2e3034; color: #3871e1; }
.item-arrow { color: #5e6065; font-size: 14px; }
.panel-empty { padding: 16px; text-align: center; color: #5e6065; font-size: 13px; }
.free-hint { padding: 10px 12px 4px; font-size: 12px; color: #82858b; }
</style>
