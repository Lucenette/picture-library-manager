<template>
  <div class="process-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <div class="toolbar-right">
        <el-button type="primary" @click="openBatchDialog">
          批量处理 ({{ selectedIds.length || groupTotal }})
        </el-button>
        <el-button :disabled="selectedIds.length === 0" @click="excludeSelected">标记排除</el-button>
        <el-button :disabled="selectedIds.length === 0" @click="unexcludeSelected">取消排除</el-button>
      </div>
    </div>

    <div v-if="mode === 'list'" class="table-wrap">
      <el-table
        ref="tableRef"
        :data="tableGroups"
        row-key="id"
        style="width: 100%"
        @sort-change="onSortChange"
        @select="onRowSelect"
        @select-all="onSelectAll"
      >
        <el-table-column type="selection" width="45" reserve-selection />
        <el-table-column prop="sourceName" label="来源" width="140" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="characterName" label="角色" width="160" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="dirName" label="图片组" min-width="140" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="dirPath" label="路径" min-width="360" show-overflow-tooltip sortable="custom" />
        <el-table-column prop="fileCount" label="文件数" width="90" align="center" sortable="custom" />
        <el-table-column prop="status" label="状态" width="100" align="center" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="viewFiles(row)">查看文件</el-button>
            <el-button size="small" text type="danger" @click="toggleExclude(row)">
              {{ row.status === 'excluded' ? '恢复' : '排除' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <TileBoard
      v-else
      ref="tileBoardRef"
      :items="tileItems"
      :expanded-id="expandedGroupId"
      :select-state="groupSelectState"
      :loading="tileGroupsLoading"
      :selection-active="selectedIds.length > 0"
      @expand="toggleGroup"
      @select="toggleGroupSelection"
      @load-more="loadMoreGroups"
    >
      <template #panel="{ item }">
        <el-scrollbar ref="panelScrollRef" class="panel-scroll" max-height="var(--tile-panel-max-height)" @scroll="onPanelScroll">
          <div v-if="panelFiles.length > 0" class="panel-grid">
            <div v-for="file in panelFiles" :key="file.id" class="panel-item">
              <img
                v-if="file.thumbnail"
                class="panel-thumb"
                :src="file.thumbnail"
                :title="file.fileName"
                @click="openGroupFile(item, file)"
              />
              <span v-else class="panel-thumb panel-thumb-empty" @click="openGroupFile(item, file)">🖼</span>
              <span class="panel-name" :title="file.fileName">{{ file.fileName }}</span>
            </div>
          </div>
          <div v-else-if="!panelLoading" class="panel-empty">这个图片组没有图片</div>
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
        :total="groupTotal"
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
import type { ScrollbarInstance, TableInstance } from 'element-plus';

import { IPC } from '@common/ipcChannels';
import type {
  BatchProcessInitData, FileViewerInitData, ImageFile, ImageGroupFilter, ImageGroupSort, ImageGroupSortKey,
  ImageGroupStatus, ImageGroupView, ProcessScript, Source, TaskView, ViewerOpenRequest,
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
  countImageGroups, getAllSources, getGroupCovers, getImageFilePage, getImageGroupIdByFilePath, getImageGroupPage,
  getImageFilesByGroup, getScriptsByType, updateImageGroupStatus, upsertProcessedImage,
} from '@/db/database';
import { alertDialog } from '@/services/dialog-service';

/** 状态筛选项 */
const STATUS_ITEMS: FilterItem[] = [
  { label: '未处理', value: 'pending' },
  { label: '已处理', value: 'processed' },
  { label: '已排除', value: 'excluded' },
];

/** 平铺一级（图组）每页取多少个 */
const TILE_PAGE_SIZE = 60;

/** 筛选变化后等这么久再查询；连点筛选项时只打一次 */
const FILTER_DEBOUNCE_MS = 200;

/** 展开面板距底部不足这么多像素就请求下一片 */
const PANEL_LOAD_MORE_THRESHOLD = 200;

/** 提交批量任务时按这么大的片把当前筛选的图组取完（图组行很轻，但一次也不拉全量） */
const GROUP_FETCH_PAGE_SIZE = 200;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const { mode, toggle: toggleMode } = useViewMode('process');

const scripts = ref<ProcessScript[]>([]);
const sources = ref<Source[]>([]);
const selectedIds = ref<number[]>([]);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const sourceFilter = ref<number | undefined>(undefined);
const characterFilter = ref('');
const pathFilter = ref('');
const statusFilter = ref('');

const tableGroups = ref<ImageGroupView[]>([]);
const groupTotal = ref(0);
const tableRef = ref<TableInstance | null>(null);
const panelScrollRef = ref<ScrollbarInstance | null>(null);

const tileGroups = ref<ImageGroupView[]>([]);
const tileGroupsLoading = ref(false);
/** 图组 id → 最多三张封面 */
const groupCovers = ref(new Map<number, (string | null)[]>());
const expandedGroupId = ref<number | null>(null);
const panelFiles = ref<ImageFile[]>([]);
const panelLoading = ref(false);
const tileBoardRef = ref<InstanceType<typeof TileBoard> | null>(null);

/** 打开「查看文件」的那个图组：手动确认要它的角色 / 来源 / 路径 */
const fileViewerGroup = ref<ImageGroupView | null>(null);

/** 本次要等的选图任务 id；0 表示没有在等 */
const watchedProcessTaskId = ref(0);

// 查询序号：并发请求回来时只认最后一次，防止过期响应覆盖新结果
let tableRequestSeq = 0;
let tileRequestSeq = 0;
let panelRequestSeq = 0;

/** 筛选防抖定时器；组件卸载时要清掉 */
let filterReloadTimer: ReturnType<typeof setTimeout> | null = null;

const { actions } = useTasks();

const { order: filterOrder, activate: activateFilter, deactivate: deactivateFilter } = useFilterOrder(() => {
  scheduleFilterReload();
});

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const selectedIdSet = computed(() => new Set(selectedIds.value));

/** 当前视图真正加载了的那批行；筛选候选只能从这里取 */
const loadedGroups = computed(() => (mode.value === 'tile' ? tileGroups.value : tableGroups.value));

const sourceItems = computed<FilterItem[]>(() =>
  sources.value.map((source) => ({ label: source.name, value: String(source.id) })),
);

const characterItems = computed<FilterItem[]>(() =>
  [...new Set(loadedGroups.value.map((group) => group.characterName))]
    .sort()
    .map((name) => ({ label: name, value: name })),
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
    key: 'path',
    label: '路径',
    value: pathFilter.value,
    display: pathFilter.value,
    items: [],
    onSelect: (value: string) => {
      pathFilter.value = value;
      activateFilter('path');
    },
    onClear: () => {
      pathFilter.value = '';
      deactivateFilter('path');
    },
  },
  {
    key: 'status',
    label: '状态',
    value: statusFilter.value,
    display: STATUS_ITEMS.find((item) => item.value === statusFilter.value)?.label ?? '',
    items: STATUS_ITEMS,
    onSelect: (value: string) => {
      statusFilter.value = value;
      activateFilter('status');
    },
    onClear: () => {
      statusFilter.value = '';
      deactivateFilter('status');
    },
  },
]);

const tileItems = computed<TileItem[]>(() =>
  tileGroups.value.map((group) => ({
    id: group.id,
    title: group.dirName,
    subtitle: group.sourceName + ' · ' + group.characterName,
    count: group.fileCount,
    covers: (groupCovers.value.get(group.id) ?? []).filter((cover): cover is string => cover !== null),
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
watch(tableGroups, () => {
  void nextTick(() => {
    const table = tableRef.value;
    if (!table || mode.value !== 'list') {
      return;
    }
    for (const row of tableGroups.value) {
      table.toggleRowSelection(row, selectedIdSet.value.has(row.id));
    }
  });
});

// 选图任务结束后刷新列表，让处理状态立刻反映出来
useIpcListener(IPC.TASK_CHANGED, (list: TaskView[]) => {
  if (watchedProcessTaskId.value === 0) {
    return;
  }
  const task = list.find((item) => item.id === watchedProcessTaskId.value);
  if (!task) {
    return;
  }
  if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
    watchedProcessTaskId.value = 0;
    void reload();
  }
});

useIpcListener(IPC.FILE_VIEWER_SELECTED, (filePath: string) => {
  void confirmSelectedFile(filePath);
});

useIpcListener(IPC.BATCH_PROCESS_CONFIRMED, (scriptId: number) => {
  void submitProcessTask(scriptId);
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
    getImageGroupPage(filter, currentSort(), pageSize.value, (page.value - 1) * pageSize.value),
    countImageGroups(filter),
  ]);
  if (seq !== tableRequestSeq) {
    return;
  }
  tableGroups.value = rows;
  groupTotal.value = total;
}

/**
 * 取平铺一级（图组）的一页。
 *
 * reset 为真表示换了筛选：从头取并顺带更新总数；否则在末尾追加。
 */
async function loadTileGroups(reset: boolean): Promise<void> {
  const seq = (tileRequestSeq += 1);
  const filter = currentFilter();
  const offset = reset ? 0 : tileGroups.value.length;
  tileGroupsLoading.value = true;
  try {
    const rows = await getImageGroupPage(filter, currentSort(), TILE_PAGE_SIZE, offset);
    if (seq !== tileRequestSeq) {
      return;
    }
    if (!reset && rows.length === 0) {
      // 已经到末尾：不要换成新数组，否则 TileBoard 会以「列表变了」为由再请求一次
      return;
    }
    tileGroups.value = reset ? rows : [...tileGroups.value, ...rows];
    if (reset && seq === tileRequestSeq) {
      groupTotal.value = await countImageGroups(filter);
    }
    await loadGroupCovers(rows.map((group) => group.id));
  } finally {
    if (seq === tileRequestSeq) {
      tileGroupsLoading.value = false;
    }
  }
}

async function loadGroupCovers(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const covers = await getGroupCovers(ids);
  const next = new Map(groupCovers.value);
  // 同一个分组会回来多行（rn 1..3），按 rn 顺序攒成数组
  for (const cover of covers) {
    next.set(cover.id, [...(next.get(cover.id) ?? []), cover.thumbnail]);
  }
  groupCovers.value = next;
}

async function loadPanelFiles(groupId: number, reset: boolean): Promise<void> {
  const seq = (panelRequestSeq += 1);
  const offset = reset ? 0 : panelFiles.value.length;
  panelLoading.value = true;
  try {
    const rows = await getImageFilePage(groupId, TILE_PAGE_SIZE, offset);
    if (seq !== panelRequestSeq || expandedGroupId.value !== groupId) {
      return;
    }
    panelFiles.value = reset ? rows : [...panelFiles.value, ...rows];
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

/** 按当前视图取数：平铺取一级，列表取表格那一页 */
async function reload(): Promise<void> {
  if (mode.value === 'tile') {
    await loadTileGroups(true);
    await nextTick();
    tileBoardRef.value?.scrollToTop();
    return;
  }
  await resetTablePage();
}

/** 筛选条件变了：防抖后再回第一页重新取数，避免连点筛选项打出多轮查询 */
function scheduleFilterReload(): void {
  if (filterReloadTimer !== null) {
    clearTimeout(filterReloadTimer);
  }
  filterReloadTimer = setTimeout(() => {
    filterReloadTimer = null;
    expandedGroupId.value = null;
    panelFiles.value = [];
    void reload();
  }, FILTER_DEBOUNCE_MS);
}

function onToggleView(): void {
  toggleMode();
  expandedGroupId.value = null;
  panelFiles.value = [];
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

async function toggleGroup(item: TileItem): Promise<void> {
  if (expandedGroupId.value === item.id) {
    expandedGroupId.value = null;
    panelFiles.value = [];
    return;
  }
  expandedGroupId.value = item.id;
  panelFiles.value = [];
  panelScrollRef.value?.setScrollTop(0);
  await loadPanelFiles(item.id, true);
}

async function loadMoreGroups(): Promise<void> {
  if (tileGroups.value.length >= groupTotal.value) {
    return;
  }
  await loadTileGroups(false);
}

function groupSelectState(id: number): TileSelectState {
  return selectedIdSet.value.has(id) ? 'checked' : 'none';
}

function toggleGroupSelection(item: TileItem): void {
  if (selectedIdSet.value.has(item.id)) {
    deselectGroup(item.id);
  } else {
    selectGroup(item.id);
  }
}

function onPanelScroll(): void {
  const wrap = panelScrollRef.value?.wrapRef as HTMLElement | undefined;
  if (!wrap) {
    return;
  }
  if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight > PANEL_LOAD_MORE_THRESHOLD) {
    return;
  }
  void loadMorePanelFiles();
}

async function loadMorePanelFiles(): Promise<void> {
  const groupId = expandedGroupId.value;
  if (groupId === null || panelLoading.value) {
    return;
  }
  const group = tileGroups.value.find((item) => item.id === groupId);
  if (!group || panelFiles.value.length >= group.fileCount) {
    return;
  }
  await loadPanelFiles(groupId, false);
}

// ------------------------------------------------------------
// 选中
// ------------------------------------------------------------

function selectGroup(id: number): void {
  if (selectedIds.value.includes(id)) {
    return;
  }
  selectedIds.value = [...selectedIds.value, id];
}

function deselectGroup(id: number): void {
  selectedIds.value = selectedIds.value.filter((item) => item !== id);
}

function onRowSelect(selection: ImageGroupView[], row: ImageGroupView): void {
  if (selection.includes(row)) {
    selectGroup(row.id);
  } else {
    deselectGroup(row.id);
  }
}

function onSelectAll(selection: ImageGroupView[]): void {
  const selected = new Set(selection.map((row) => row.id));
  for (const row of tableGroups.value) {
    if (selected.has(row.id)) {
      selectGroup(row.id);
    } else {
      deselectGroup(row.id);
    }
  }
}

// ------------------------------------------------------------
// 查看器
// ------------------------------------------------------------

/** 展开面板里的图片：打开它所在的图组并定位到这一张 */
async function openGroupFile(item: TileItem, file: ImageFile): Promise<void> {
  const request: ViewerOpenRequest = {
    source: { kind: 'group', groupId: item.id, startId: file.id },
    title: item.title + ' - ' + file.fileName,
  };
  await ipcRenderer.invoke(IPC.VIEWER_OPEN, request);
}

/** 表格视图的「查看文件」；平铺下展开面板已经能看到图片，不再提供这个入口 */
async function viewFiles(group: ImageGroupView): Promise<void> {
  fileViewerGroup.value = group;
  const payload: FileViewerInitData = {
    files: await getImageFilesByGroup(group.id),
    groupId: group.id,
    groupName: group.dirName,
    groupDirPath: group.dirPath,
  };
  ipcRenderer.invoke(IPC.FILE_VIEWER_OPEN, payload);
}

function statusTagType(status: ImageGroupStatus): 'info' | 'success' | 'danger' {
  if (status === 'processed') {
    return 'success';
  }
  if (status === 'excluded') {
    return 'danger';
  }
  return 'info';
}

function statusLabel(status: ImageGroupStatus): string {
  if (status === 'processed') {
    return '已处理';
  }
  if (status === 'excluded') {
    return '已排除';
  }
  return '未处理';
}

// ------------------------------------------------------------
// 状态变更
// ------------------------------------------------------------

async function toggleExclude(group: ImageGroupView): Promise<void> {
  const nextStatus: ImageGroupStatus = group.status === 'excluded' ? 'pending' : 'excluded';
  await updateImageGroupStatus(group.id, nextStatus);
  await reload();
}

async function excludeSelected(): Promise<void> {
  for (const id of selectedIds.value) {
    await updateImageGroupStatus(id, 'excluded');
  }
  await reload();
}

async function unexcludeSelected(): Promise<void> {
  for (const id of selectedIds.value) {
    await updateImageGroupStatus(id, 'pending');
  }
  await reload();
}

// ------------------------------------------------------------
// 手动确认
// ------------------------------------------------------------

/** 在文件查看窗口中选定某张图后，把它记为所属图片组的处理结果 */
async function confirmSelectedFile(filePath: string): Promise<void> {
  const groupId = await getImageGroupIdByFilePath(filePath);
  if (groupId === null) {
    return;
  }
  const opened = fileViewerGroup.value;
  const group = opened && opened.id === groupId ? opened : findLoadedGroup(groupId);
  if (!group) {
    return;
  }

  try {
    await upsertProcessedImage(group.id, group.characterId, group.sourceId, group.dirPath, filePath, null);
    await reload();
  } catch (error) {
    await alertDialog({ title: '确认失败', message: (error as Error).message, danger: true });
  }
}

// ------------------------------------------------------------
// 批量选图
// ------------------------------------------------------------

async function openBatchDialog(): Promise<void> {
  const targets = await resolveTargets();
  if (targets.length === 0) {
    ElMessage.warning('选中的图片组都被排除');
    return;
  }

  const payload: BatchProcessInitData = {
    scripts: scripts.value.map((script) => ({ id: script.id, name: script.name })),
    count: targets.length,
  };
  ipcRenderer.invoke(IPC.BATCH_PROCESS_OPEN, payload);
}

/** 提交时把目标固化成 id 快照，执行期间筛选或数据变化都不影响本次任务 */
async function submitProcessTask(scriptId: number): Promise<void> {
  const targets = await resolveTargets();
  if (targets.length === 0) {
    ElMessage.warning('选中的图片组都已被排除');
    return;
  }

  watchedProcessTaskId.value = await actions.submit('process', { groupIds: targets.map((group) => group.id), scriptId });
  ElMessage.success(`已提交 ${targets.length} 个图片组的选图任务，可在「任务」页查看进度`);
}

// ------------------------------------------------------------
// 内部工具
// ------------------------------------------------------------

/** 当前筛选条件：表格与平铺共用同一份 */
function currentFilter(): ImageGroupFilter {
  return {
    status: statusFilter.value ? (statusFilter.value as ImageGroupStatus) : undefined,
    sourceId: sourceFilter.value,
    characterName: characterFilter.value || undefined,
    dirPath: pathFilter.value || undefined,
  };
}

/** 表格列名映射到排序键；没排序时交给主进程用「来源 → 角色 → 目录名」 */
function currentSort(): ImageGroupSort | undefined {
  let key: ImageGroupSortKey;
  if (sortProp.value === 'sourceName') {
    key = 'source';
  } else if (sortProp.value === 'characterName') {
    key = 'character';
  } else if (sortProp.value === 'dirName') {
    key = 'dirName';
  } else if (sortProp.value === 'dirPath') {
    key = 'dirPath';
  } else if (sortProp.value === 'fileCount') {
    key = 'fileCount';
  } else if (sortProp.value === 'status') {
    key = 'status';
  } else {
    return undefined;
  }
  return { key, direction: sortOrder.value === 'descending' ? 'desc' : 'asc' };
}

/** 分片把当前筛选下的图组取完：批量任务要的可能不在当前页 */
async function fetchFilteredGroups(): Promise<ImageGroupView[]> {
  const filter = currentFilter();
  const sort = currentSort();
  const all: ImageGroupView[] = [];
  for (let offset = 0; ; offset += GROUP_FETCH_PAGE_SIZE) {
    const page = await getImageGroupPage(filter, sort, GROUP_FETCH_PAGE_SIZE, offset);
    all.push(...page);
    if (page.length < GROUP_FETCH_PAGE_SIZE) {
      break;
    }
  }
  return all;
}

/** 待处理的图片组：优先取勾选项，未勾选时取当前筛选结果，两者都排除已排除项 */
async function resolveTargets(): Promise<ImageGroupView[]> {
  const groups = await fetchFilteredGroups();
  const candidates = selectedIds.value.length > 0
    ? groups.filter((group) => selectedIds.value.includes(group.id))
    : groups;
  return candidates.filter((group) => group.status !== 'excluded');
}

/** 已加载的图组里按 id 找；找不到说明它不在当前筛选结果里 */
function findLoadedGroup(id: number): ImageGroupView | undefined {
  return tableGroups.value.find((group) => group.id === id)
    ?? tileGroups.value.find((group) => group.id === id);
}
</script>

<style scoped>
.process-page {
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  justify-items: center;
  /* 与一级卡片同一套间距：横向 20px、纵向 24px */
  column-gap: 20px;
  row-gap: 24px;
  /* 留出悬停放大与阴影的余量，否则第一行 / 第一列会被滚动容器裁掉 */
  padding: 6px;
}

.panel-item {
  position: relative;
  width: 100px;
}

/* 手型光标与点击都只认图片，不认整个盒子 */
.panel-thumb {
  cursor: pointer;
}

.panel-item:hover {
  z-index: 5;
}

.panel-thumb:hover {
  transform: scale(1.1);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.6);
}

.panel-thumb {
  display: block;
  width: 100px;
  height: 100px;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  object-fit: cover;
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
  margin-top: 8px;
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
