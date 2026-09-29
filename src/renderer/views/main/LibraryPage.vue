<template>
  <div class="library-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <div class="toolbar-right">
        <el-button :disabled="recognizing" @click="recognizeSimilar">
          {{ recognizing ? '识别中…' : '识别相似图片' }}
        </el-button>
        <el-button type="danger" :disabled="selectedIds.length === 0" @click="batchDelete">
          删除选中 ({{ selectedIds.length }})
        </el-button>
        <el-button type="success" :disabled="indexRows.length === 0" @click="exportImages">
          <el-icon><Download /></el-icon> 导出 ({{ selectedIds.length || indexRows.length }})
        </el-button>
      </div>
    </div>

    <div v-if="mode === 'list'" class="table-wrap">
      <el-table
        ref="tableRef"
        :data="tableRows"
        row-key="id"
        style="width: 100%"
        @sort-change="onSortChange"
        @select="onRowSelect"
        @select-all="onSelectAll"
      >
        <el-table-column type="selection" width="45" reserve-selection />
        <el-table-column label="预览" width="90">
          <template #default="{ row }">
            <img
              v-if="row.selectedFileThumbnail"
              class="preview"
              :src="row.selectedFileThumbnail"
              @click="openImageViewer(row)"
            />
            <span v-else style="font-size: 24px">🖼</span>
          </template>
        </el-table-column>
        <el-table-column prop="characterName" label="角色" width="160" sortable="custom" />
        <el-table-column prop="selectedFileName" label="文件名" min-width="220" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="scriptName" label="处理脚本" width="150" sortable="custom">
          <template #default="{ row }">{{ scriptLabel(row) }}</template>
        </el-table-column>
        <el-table-column prop="confirmedAt" label="确认时间" width="170" sortable="custom" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="deleteOne(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <TileBoard
      v-else
      ref="tileBoardRef"
      :items="tileItems"
      :expanded-id="expandedCharacterId"
      :select-state="characterSelectState"
      :loading="tileCharactersLoading"
      @expand="toggleCharacter"
      @select="toggleCharacterSelection"
      @open="openCharacter"
      @load-more="loadMoreCharacters"
    >
      <template #panel>
        <el-scrollbar ref="panelScrollRef" class="panel-scroll" max-height="360px" @scroll="onPanelScroll">
          <div v-if="panelImages.length > 0" class="panel-grid">
            <div
              v-for="image in panelImages"
              :key="image.id"
              class="panel-item"
              :class="{ selected: selectedIdSet.has(image.id) }"
              @click="openImageViewer(image)"
            >
              <img v-if="image.selectedFileThumbnail" class="panel-thumb" :src="image.selectedFileThumbnail" />
              <span v-else class="panel-thumb panel-thumb-empty">🖼</span>
              <el-checkbox
                class="panel-check"
                :model-value="selectedIdSet.has(image.id)"
                @click.stop
                @change="toggleImageSelection(image.id)"
              />
              <span class="panel-name" :title="image.selectedFileName">{{ image.selectedFileName }}</span>
            </div>
          </div>
          <div v-else-if="!panelLoading" class="panel-empty">没有可显示的图片</div>
          <div v-if="panelLoading" class="panel-loading">加载中…</div>
        </el-scrollbar>
      </template>
    </TileBoard>

    <div class="footer">
      <ViewSwitchButton :mode="mode" @toggle="onToggleView" />
      <el-pagination
        v-if="mode === 'list'"
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="tableTotal"
        layout="total, sizes, prev, pager, next, jumper"
        class="pager"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ipcRenderer } from 'electron';
import { ElMessage } from 'element-plus';
import { Download } from '@element-plus/icons-vue';
import type { ScrollbarInstance, TableInstance } from 'element-plus';

import { IPC } from '@common/ipcChannels';
import type {
  CharacterTile, ProcessedFilter, ProcessedImageView, ProcessedIndexRow, ProcessedSort, ProcessedSortKey,
  ProcessScript, Source, TaskView, ViewerOpenRequest,
} from '@common/types';

import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterItem, FilterSection } from '@/components/CategorySearch.types';
import TileBoard from '@/components/TileBoard.vue';
import type { TileItem, TileSelectState } from '@/components/TileBoard.types';
import ViewSwitchButton from '@/components/ViewSwitchButton.vue';
import { useFilterOrder } from '@/composables/useFilterOrder';
import { useIpcListener } from '@/composables/useIpcListener';
import { useTasks } from '@/composables/useTasks';
import { useViewMode } from '@/composables/useViewMode';
import {
  countProcessedCharacters, countProcessedImages, deleteProcessedImage, getAllSources, getCovers,
  getProcessedImagePage, getScriptsByType, listProcessedCharacters, listProcessedIndex,
} from '@/db/database';
import { confirmDialog } from '@/services/dialog-service';

/** 平铺一级（角色）每页取多少个 */
const TILE_PAGE_SIZE = 60;

/** 筛选变化后等这么久再查询；连点筛选项时只打一次 */
const FILTER_DEBOUNCE_MS = 200;

/** 展开面板距底部不足这么多像素就请求下一片 */
const PANEL_LOAD_MORE_THRESHOLD = 200;

/** 脚本筛选里代表「手动确认」的取值，与主进程 COALESCE(script_name, ...) 对齐 */
const MANUAL_SCRIPT_NAME = '手动确认';

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const { mode, toggle: toggleMode } = useViewMode('library');

const sources = ref<Source[]>([]);
const scripts = ref<ProcessScript[]>([]);
const selectedIds = ref<number[]>([]);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const sourceFilter = ref<number | undefined>(undefined);
const characterFilter = ref('');
const fileNameFilter = ref('');
const scriptFilter = ref('');

const tableRows = ref<ProcessedImageView[]>([]);
const tableTotal = ref(0);
const tableRef = ref<TableInstance | null>(null);

const indexRows = ref<ProcessedIndexRow[]>([]);

const tileCharacters = ref<CharacterTile[]>([]);
const tileCharacterTotal = ref(0);
const tileCharactersLoading = ref(false);
/** 角色 id → 最多三张封面；键是卡片句柄（该名字下最小的 character id） */
const characterCovers = ref(new Map<number, (string | null)[]>());
const expandedCharacterId = ref<number | null>(null);
const panelImages = ref<ProcessedImageView[]>([]);
const panelLoading = ref(false);
const tileBoardRef = ref<InstanceType<typeof TileBoard> | null>(null);
const panelScrollRef = ref<ScrollbarInstance | null>(null);

/** 相似图片识别是否在跑：跑的过程中禁用按钮 */
const recognizing = ref(false);
/** 本次要等的识别任务 id；0 表示没有在等 */
const watchedTaskId = ref(0);
/** 本次要等的导出任务 id；0 表示没有在等 */
const watchedExportTaskId = ref(0);

// 查询序号：并发请求回来时只认最后一次，防止过期响应覆盖新结果
let tableRequestSeq = 0;
let indexRequestSeq = 0;
let tileRequestSeq = 0;
let panelRequestSeq = 0;

/** 筛选防抖定时器；组件卸载时要清掉 */
let filterReloadTimer: ReturnType<typeof setTimeout> | null = null;

const { tasks, actions } = useTasks();

const { order: filterOrder, activate: activateFilter, deactivate: deactivateFilter } = useFilterOrder(() => {
  scheduleFilterReload();
});

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const selectedIdSet = computed(() => new Set(selectedIds.value));

const sourceItems = computed<FilterItem[]>(() =>
  sources.value.map((source) => ({ label: source.name, value: String(source.id) })),
);

/** 角色候选来自当前筛选下的轻量索引，与分页无关，所以是完整的 */
const characterItems = computed<FilterItem[]>(() =>
  toFilterItems(indexRows.value.map((row) => row.characterName)),
);

/** 脚本候选只有现存的选图脚本；已删除脚本留下的名字仍可手工输入 */
const scriptItems = computed<FilterItem[]>(() =>
  toFilterItems([...scripts.value.map((script) => script.name), MANUAL_SCRIPT_NAME]),
);

const filterSections = computed<FilterSection[]>(() => [
  {
    key: 'source',
    label: '来源',
    value: sourceFilter.value ? String(sourceFilter.value) : '',
    display: sources.value.find((source) => source.id === sourceFilter.value)?.name ?? '',
    items: sourceItems.value,
    onSelect: (value: string) => {
      sourceFilter.value = Number(value);
      activateFilter('source');
    },
    onClear: () => {
      sourceFilter.value = undefined;
      deactivateFilter('source');
    },
  },
  {
    key: 'character',
    label: '角色',
    value: characterFilter.value,
    display: characterFilter.value,
    items: characterItems.value,
    onSelect: (value: string) => {
      characterFilter.value = value;
      activateFilter('character');
    },
    onClear: () => {
      characterFilter.value = '';
      deactivateFilter('character');
    },
  },
  {
    key: 'filename',
    label: '文件名',
    value: fileNameFilter.value,
    display: fileNameFilter.value,
    items: [],
    onSelect: (value: string) => {
      fileNameFilter.value = value;
      activateFilter('filename');
    },
    onClear: () => {
      fileNameFilter.value = '';
      deactivateFilter('filename');
    },
  },
  {
    key: 'script',
    label: '处理脚本',
    value: scriptFilter.value,
    display: scriptFilter.value,
    items: scriptItems.value,
    onSelect: (value: string) => {
      scriptFilter.value = value;
      activateFilter('script');
    },
    onClear: () => {
      scriptFilter.value = '';
      deactivateFilter('script');
    },
  },
]);

/** 角色名 → 当前筛选下该角色全部图片的 id；平铺三态与整卡勾选都靠它 */
const indexIdsByCharacter = computed(() => {
  const map = new Map<string, number[]>();
  for (const row of indexRows.value) {
    const ids = map.get(row.characterName);
    if (ids) {
      ids.push(row.id);
    } else {
      map.set(row.characterName, [row.id]);
    }
  }
  return map;
});

const tileItems = computed<TileItem[]>(() =>
  tileCharacters.value.map((character) => ({
    id: character.characterId,
    title: character.characterName,
    subtitle: character.count + ' 张',
    count: character.count,
    covers: (characterCovers.value.get(character.characterId) ?? []).filter((cover): cover is string => cover !== null),
  })),
);

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

onMounted(() => {
  void loadSources();
  void loadScripts();
  void reload();
});

onUnmounted(() => {
  if (filterReloadTimer !== null) {
    clearTimeout(filterReloadTimer);
    filterReloadTimer = null;
  }
});

// 换页长要回到第一页；页码与页长的实际取数都交给下面这个 watcher
watch(pageSize, () => {
  page.value = 1;
});

// 页码变化就重新取那一页；筛选变化统一走 reload
watch([page, pageSize], () => {
  if (mode.value === 'list') {
    void loadTableData();
  }
});

// 翻页 / 切换视图后表格会重新挂载，把 selectedIds 里的勾选补回当前页的复选框上
watch(tableRows, () => {
  void nextTick(() => {
    const table = tableRef.value;
    if (!table || mode.value !== 'list') {
      return;
    }
    for (const row of tableRows.value) {
      table.toggleRowSelection(row, selectedIdSet.value.has(row.id));
    }
  });
});

// 只盯自己提交的那条识别任务：完成就开窗，失败或被取消就放开按钮
watch(tasks, (list) => {
  if (watchedTaskId.value === 0) {
    return;
  }

  const task = list.find((item) => item.id === watchedTaskId.value);
  if (!task) {
    return;
  }

  if (task.status === 'done') {
    watchedTaskId.value = 0;
    recognizing.value = false;
    void ipcRenderer.invoke(IPC.SIMILAR_OPEN);
    return;
  }

  if (task.status === 'failed' || task.status === 'cancelled') {
    watchedTaskId.value = 0;
    recognizing.value = false;
    ElMessage.error('识别相似图片未完成，详情见任务页');
  }
}, { deep: true });

// 导出任务结束后刷新列表，让新增的失败记录可见
useIpcListener(IPC.TASK_CHANGED, (list: TaskView[]) => {
  if (watchedExportTaskId.value === 0) {
    return;
  }
  const task = list.find((item) => item.id === watchedExportTaskId.value);
  if (!task) {
    return;
  }
  if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
    watchedExportTaskId.value = 0;
    void reload();
  }
});

// ------------------------------------------------------------
// 取数
// ------------------------------------------------------------

async function loadSources(): Promise<void> {
  sources.value = await getAllSources();
}

async function loadScripts(): Promise<void> {
  scripts.value = await getScriptsByType('select-image');
}

async function loadTableData(): Promise<void> {
  const seq = (tableRequestSeq += 1);
  const filter = currentFilter();
  const [rows, total] = await Promise.all([
    getProcessedImagePage(filter, currentSort(), pageSize.value, (page.value - 1) * pageSize.value),
    countProcessedImages(filter),
  ]);
  if (seq !== tableRequestSeq) {
    return;
  }
  tableRows.value = rows;
  tableTotal.value = total;
}

async function loadIndexRows(): Promise<void> {
  const seq = (indexRequestSeq += 1);
  const rows = await listProcessedIndex(currentFilter());
  if (seq !== indexRequestSeq) {
    return;
  }
  indexRows.value = rows;
}

/**
 * 取平铺一级（角色）的一页。
 *
 * reset 为真表示换了筛选：从头取并顺带更新总数；否则在末尾追加。
 */
async function loadTileCharacters(reset: boolean): Promise<void> {
  const seq = (tileRequestSeq += 1);
  const filter = currentFilter();
  const offset = reset ? 0 : tileCharacters.value.length;
  tileCharactersLoading.value = true;
  try {
    const rows = await listProcessedCharacters(filter, TILE_PAGE_SIZE, offset);
    if (seq !== tileRequestSeq) {
      return;
    }
    if (!reset && rows.length === 0) {
      // 已经到末尾：不要换成新数组，否则 TileBoard 会以「列表变了」为由再请求一次
      return;
    }
    tileCharacters.value = reset ? rows : [...tileCharacters.value, ...rows];
    if (reset && seq === tileRequestSeq) {
      tileCharacterTotal.value = await countProcessedCharacters(filter);
    }
    await loadCharacterCovers(rows.map((row) => row.characterId));
  } finally {
    if (seq === tileRequestSeq) {
      tileCharactersLoading.value = false;
    }
  }
}

async function loadCharacterCovers(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const covers = await getCovers('character', ids);
  const next = new Map(characterCovers.value);
  // 同一个分组会回来多行（rn 1..3），按 rn 顺序攒成数组
  for (const cover of covers) {
    next.set(cover.id, [...(next.get(cover.id) ?? []), cover.thumbnail]);
  }
  characterCovers.value = next;
}

async function loadPanelImages(characterId: number, reset: boolean): Promise<void> {
  const character = tileCharacters.value.find((tile) => tile.characterId === characterId);
  if (!character) {
    return;
  }
  const seq = (panelRequestSeq += 1);
  const offset = reset ? 0 : panelImages.value.length;
  const filter: ProcessedFilter = { ...currentFilter(), characterName: character.characterName };
  panelLoading.value = true;
  try {
    const rows = await getProcessedImagePage(filter, currentSort(), TILE_PAGE_SIZE, offset);
    if (seq !== panelRequestSeq || expandedCharacterId.value !== characterId) {
      return;
    }
    panelImages.value = reset ? rows : [...panelImages.value, ...rows];
  } finally {
    if (seq === panelRequestSeq) {
      panelLoading.value = false;
    }
  }
}

// ------------------------------------------------------------
// 分页与视图切换
// ------------------------------------------------------------

/** 把表格翻回第一页；页码真的变化时交给 watch 取数，避免重复请求 */
async function resetTablePage(): Promise<void> {
  if (page.value !== 1) {
    page.value = 1;
    return;
  }
  await loadTableData();
}

/** 按当前视图取数：平铺取一级，列表取表格那一页；索引行两种视图都要（导出与三态） */
async function reload(): Promise<void> {
  const jobs: Promise<void>[] = [loadIndexRows()];
  if (mode.value === 'tile') {
    jobs.push(loadTileCharacters(true));
  } else {
    jobs.push(resetTablePage());
  }
  await Promise.all(jobs);
  if (mode.value === 'tile') {
    await nextTick();
    tileBoardRef.value?.scrollToTop();
  }
}

/** 筛选条件变了：防抖后再回第一页重新取数，避免连点筛选项打出多轮查询 */
function scheduleFilterReload(): void {
  if (filterReloadTimer !== null) {
    clearTimeout(filterReloadTimer);
  }
  filterReloadTimer = setTimeout(() => {
    filterReloadTimer = null;
    expandedCharacterId.value = null;
    panelImages.value = [];
    void reload();
  }, FILTER_DEBOUNCE_MS);
}

function onToggleView(): void {
  toggleMode();
  expandedCharacterId.value = null;
  panelImages.value = [];
  void reload();
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
  void resetTablePage();
}

// ------------------------------------------------------------
// 平铺交互
// ------------------------------------------------------------

async function toggleCharacter(item: TileItem): Promise<void> {
  if (expandedCharacterId.value === item.id) {
    expandedCharacterId.value = null;
    panelImages.value = [];
    return;
  }
  expandedCharacterId.value = item.id;
  panelImages.value = [];
  panelScrollRef.value?.setScrollTop(0);
  await loadPanelImages(item.id, true);
}

async function loadMoreCharacters(): Promise<void> {
  if (tileCharacters.value.length >= tileCharacterTotal.value) {
    return;
  }
  await loadTileCharacters(false);
}

/** 三态：这个角色在当前筛选下共几张、其中几张已勾选 */
function characterSelectState(id: number): TileSelectState {
  const character = tileCharacters.value.find((tile) => tile.characterId === id);
  if (!character) {
    return 'none';
  }
  const ids = indexIdsByCharacter.value.get(character.characterName) ?? [];
  if (ids.length === 0) {
    return 'none';
  }
  let selected = 0;
  for (const imageId of ids) {
    if (selectedIdSet.value.has(imageId)) {
      selected += 1;
    }
  }
  if (selected === 0) {
    return 'none';
  }
  return selected === ids.length ? 'checked' : 'indeterminate';
}

/** 勾选卡片＝勾上它下面所有图片；已全选时再点＝全部取消 */
function toggleCharacterSelection(item: TileItem): void {
  const character = tileCharacters.value.find((tile) => tile.characterId === item.id);
  if (!character) {
    return;
  }
  const ids = indexIdsByCharacter.value.get(character.characterName) ?? [];
  const next = new Set(selectedIds.value);
  const allSelected = ids.length > 0 && ids.every((imageId) => next.has(imageId));
  for (const imageId of ids) {
    if (allSelected) {
      next.delete(imageId);
    } else {
      next.add(imageId);
    }
  }
  selectedIds.value = [...next];
}

function onPanelScroll(): void {
  const wrap = panelScrollRef.value?.wrapRef as HTMLElement | undefined;
  if (!wrap) {
    return;
  }
  if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight > PANEL_LOAD_MORE_THRESHOLD) {
    return;
  }
  void loadMorePanelImages();
}

async function loadMorePanelImages(): Promise<void> {
  const characterId = expandedCharacterId.value;
  if (characterId === null || panelLoading.value) {
    return;
  }
  const character = tileCharacters.value.find((tile) => tile.characterId === characterId);
  if (!character || panelImages.value.length >= character.count) {
    return;
  }
  await loadPanelImages(characterId, false);
}

// ------------------------------------------------------------
// 选中与查看器
// ------------------------------------------------------------

function selectImage(id: number): void {
  if (selectedIds.value.includes(id)) {
    return;
  }
  selectedIds.value = [...selectedIds.value, id];
}

function deselectImage(id: number): void {
  selectedIds.value = selectedIds.value.filter((item) => item !== id);
}

/**
 * 二级图片的勾选。
 *
 * 与表格共用同一份 selectedIds；悬停时才露出来，勾上以后常显（见路线图 3.2）。
 */
function toggleImageSelection(id: number): void {
  if (selectedIdSet.value.has(id)) {
    deselectImage(id);
  } else {
    selectImage(id);
  }
}

function onRowSelect(selection: ProcessedImageView[], row: ProcessedImageView): void {
  if (selection.includes(row)) {
    selectImage(row.id);
  } else {
    deselectImage(row.id);
  }
}

function onSelectAll(selection: ProcessedImageView[]): void {
  const selected = new Set(selection.map((row) => row.id));
  for (const row of tableRows.value) {
    if (selected.has(row.id)) {
      selectImage(row.id);
    } else {
      deselectImage(row.id);
    }
  }
}

/** 展开面板里的图片：打开当前筛选结果并定位到这一张 */
async function openImageViewer(row: ProcessedImageView): Promise<void> {
  const request: ViewerOpenRequest = {
    source: { kind: 'processed', filter: currentFilter(), sort: currentSort(), startId: row.id },
    title: row.characterName + ' - ' + row.selectedFileName,
  };
  await ipcRenderer.invoke(IPC.VIEWER_OPEN, request);
}

/** 卡片「打开全部」：把范围收窄到这个角色，并定位到它的第一张 */
async function openCharacter(item: TileItem): Promise<void> {
  const character = tileCharacters.value.find((tile) => tile.characterId === item.id);
  if (!character) {
    return;
  }
  const filter: ProcessedFilter = { ...currentFilter(), characterName: character.characterName };
  const firstPage = await getProcessedImagePage(filter, currentSort(), 1, 0);
  const first = firstPage[0];
  if (!first) {
    return;
  }
  const request: ViewerOpenRequest = {
    source: { kind: 'processed', filter, sort: currentSort(), startId: first.id },
    title: character.characterName,
  };
  await ipcRenderer.invoke(IPC.VIEWER_OPEN, request);
}

// ------------------------------------------------------------
// 任务
// ------------------------------------------------------------

/**
 * 提交识别任务并记住它的 id。
 *
 * 走 actions.submit 而不是直接调 submitTask：命令会返回整表（服务端已排好序），
 * 用它替换本地列表，顺序才不会错。
 */
async function recognizeSimilar(): Promise<void> {
  if (recognizing.value) {
    return;
  }
  recognizing.value = true;
  try {
    watchedTaskId.value = await actions.submit('similar', {});
    ElMessage.success('已开始识别，完成后会自动打开结果窗口');
  } catch (error) {
    recognizing.value = false;
    ElMessage.error(`提交识别任务失败：${(error as Error).message}`);
  }
}

/** 选中目录后把待导出记录固化成 id 快照，实际复制交给主进程 */
async function exportImages(): Promise<void> {
  const targetDir: string | null = await ipcRenderer.invoke(IPC.DIALOG_EXPORT_DIR);
  if (!targetDir) {
    return;
  }

  // 没勾选任何行就按当前筛选的全部导出：索引行拿到的 id 就是这份范围
  const imageIds = selectedIds.value.length > 0
    ? [...selectedIds.value]
    : indexRows.value.map((row) => row.id);
  if (imageIds.length === 0) {
    return;
  }

  watchedExportTaskId.value = await actions.submit('export', { imageIds, targetDir });
  ElMessage.success(`已提交 ${imageIds.length} 张图片的导出任务，可在「任务」页查看进度`);
}

// ------------------------------------------------------------
// 删除
// ------------------------------------------------------------

async function deleteOne(row: ProcessedImageView): Promise<void> {
  const confirmed = await confirmDialog({
    title: '删除记录',
    message: `确定删除「${row.characterName} - ${row.selectedFileName}」？\n（不会删除原始文件）`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }
  await deleteProcessedImage(row.id);
  deselectImage(row.id);
  await reload();
}

async function batchDelete(): Promise<void> {
  if (selectedIds.value.length === 0) {
    return;
  }
  const confirmed = await confirmDialog({
    title: '批量删除记录',
    message: `确定删除选中的 ${selectedIds.value.length} 条记录？\n（不会删除原始文件）`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  for (const id of selectedIds.value) {
    await deleteProcessedImage(id);
  }
  selectedIds.value = [];
  await reload();
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 当前筛选条件：表格、平铺、计数与查看器共用同一份 */
function currentFilter(): ProcessedFilter {
  return {
    sourceId: sourceFilter.value,
    characterName: characterFilter.value || undefined,
    fileName: fileNameFilter.value || undefined,
    scriptName: scriptFilter.value || undefined,
  };
}

/** 表格列名映射到排序键；没排序时按角色名升序 */
function currentSort(): ProcessedSort {
  let key: ProcessedSortKey = 'character';
  if (sortProp.value === 'selectedFileName') {
    key = 'fileName';
  } else if (sortProp.value === 'scriptName') {
    key = 'scriptName';
  } else if (sortProp.value === 'confirmedAt') {
    key = 'confirmedAt';
  }
  return { key, direction: sortOrder.value === 'descending' ? 'desc' : 'asc' };
}

/**
 * 「处理脚本」那一列显示什么。
 *
 * 名字是写入图库行时留下的副本：脚本被删掉之后它还在（改名时由主进程级联更新）；
 * 没有名字却有 script_id 说明库被手工改过、名字确实查不到了——不能假装成手动确认。
 */
function scriptLabel(row: ProcessedImageView): string {
  if (row.scriptName) {
    return row.scriptName;
  }
  return row.scriptId === null ? '手动确认' : '已删除脚本';
}

/** 去重并排序，生成下拉筛选项 */
function toFilterItems(values: string[]): FilterItem[] {
  return [...new Set(values)].sort().map((value) => ({ label: value, value }));
}
</script>

<style scoped>
.library-page {
  padding: var(--page-padding);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  flex: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  height: 100%;
}

.preview {
  width: 50px;
  height: 50px;
  object-fit: cover;
  border-radius: 4px;
  cursor: pointer;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}

.pager {
  margin-left: auto;
}

.panel-scroll {
  margin-right: -4px;
}

.panel-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.panel-item {
  position: relative;
  width: 100px;
  cursor: pointer;
}

.panel-check {
  position: absolute;
  top: 4px;
  left: 4px;
  height: auto;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.panel-item:hover .panel-check,
.panel-item.selected .panel-check {
  opacity: 1;
}

.panel-item:hover .panel-thumb {
  transform: scale(1.1);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.6);
}

.panel-thumb {
  display: block;
  width: 100px;
  height: 100px;
  object-fit: cover;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  border-radius: 6px;
  background: #2b2d30;
}

.panel-thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}

.panel-name {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #d8dadd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-empty,
.panel-loading {
  padding: 12px;
  text-align: center;
  color: #82858b;
  font-size: 12px;
}
</style>
