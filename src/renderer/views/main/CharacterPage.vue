<template>
  <div class="character-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <el-button type="primary" :disabled="selectedIds.length === 0" @click="openBatchRename">
        批量重命名 ({{ selectedIds.length }})
      </el-button>
    </div>

    <div class="table-wrap">
      <el-table
        :data="pagedCharacters"
        row-key="id"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column prop="sourceName" label="来源" width="160" sortable="custom" />
        <el-table-column prop="name" label="角色名" min-width="200" sortable="custom">
          <template #default="{ row }">
            <span class="char-name" @dblclick="openSingleRename(row)">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="sourcePath" label="源路径" min-width="300" show-overflow-tooltip />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openSingleRename(row)">重命名</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="filteredCharacters.length"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ipcRenderer } from 'electron';
import { computed, onMounted, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import type { Character, Source, PromptInitData, PromptResult } from '@common/types';

import type { FilterSection } from '@/components/CategorySearch.types';
import CategorySearch from '@/components/CategorySearch.vue';
import { useFilterOrder } from '@/composables/useFilterOrder';
import { useIpcListener } from '@/composables/useIpcListener';
import { getAllSources, getCharactersBySource, renameCharacter } from '@/db/database';
import { alertDialog } from '@/services/dialog-service';

/** 列表行：角色实体 + 所属来源名 */
type CharacterRow = Character & { sourceName: string };

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const characters = ref<CharacterRow[]>([]);
const sources = ref<Source[]>([]);
const selectedIds = ref<number[]>([]);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const sourceFilter = ref<number | undefined>(undefined);
const nameFilter = ref('');
const pathFilter = ref('');

const { order: filterOrder, activate: activateFilter, deactivate: deactivateFilter } = useFilterOrder(() => {
  page.value = 1;
});

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const sourceItems = computed(() =>
  sources.value.map((source) => ({ label: source.name, value: String(source.id) })),
);

const filteredCharacters = computed(() => {
  let list = characters.value;

  if (sourceFilter.value) {
    list = list.filter((item) => item.sourceId === sourceFilter.value);
  }
  if (nameFilter.value) {
    const keyword = nameFilter.value.toLowerCase();
    list = list.filter((item) => item.name.toLowerCase().includes(keyword));
  }
  if (pathFilter.value) {
    const keyword = pathFilter.value.toLowerCase();
    list = list.filter((item) => item.sourcePath.toLowerCase().includes(keyword));
  }

  const prop = sortProp.value as keyof CharacterRow | null;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...list].sort(
      (a, b) => a.sourceName.localeCompare(b.sourceName) || a.name.localeCompare(b.name),
    );
  }

  const direction = order === 'ascending' ? 1 : -1;
  return [...list].sort((a, b) => String(a[prop] ?? '').localeCompare(String(b[prop] ?? '')) * direction);
});

const pagedCharacters = computed(() =>
  filteredCharacters.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
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
    key: 'name',
    label: '角色名',
    value: nameFilter.value,
    display: nameFilter.value,
    items: [],
    onSelect: (value: string) => {
      nameFilter.value = value;
      activateFilter('name');
    },
    onClear: () => {
      nameFilter.value = '';
      deactivateFilter('name');
    },
  },
  {
    key: 'path',
    label: '源路径',
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
]);

// ------------------------------------------------------------
// 列表操作
// ------------------------------------------------------------

async function loadData(): Promise<void> {
  sources.value = await getAllSources();

  const rows: CharacterRow[] = [];
  for (const source of sources.value) {
    const sourceCharacters = await getCharactersBySource(source.id);
    for (const character of sourceCharacters) {
      rows.push({ ...character, sourceName: source.name });
    }
  }
  characters.value = rows;
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

function onSelectionChange(rows: CharacterRow[]): void {
  selectedIds.value = rows.map((row) => row.id);
}

// ------------------------------------------------------------
// 重命名
// ------------------------------------------------------------

function openSingleRename(row: CharacterRow): void {
  const payload: PromptInitData = {
    title: '重命名角色',
    placeholder: '新名称',
    value: row.name,
    channel: IPC.SINGLE_RENAME_CONFIRMED,
    rowId: row.id,
  };
  void ipcRenderer.invoke(IPC.PROMPT_OPEN, payload);
}

function openBatchRename(): void {
  const first = characters.value.find((character) => selectedIds.value.includes(character.id));
  const payload: PromptInitData = {
    title: '批量重命名',
    placeholder: '输入新角色名',
    value: first?.name ?? '',
    channel: IPC.BATCH_RENAME_CONFIRMED,
  };
  void ipcRenderer.invoke(IPC.PROMPT_OPEN, payload);
}

useIpcListener(IPC.SINGLE_RENAME_CONFIRMED, async (result: PromptResult) => {
  if (!result.value || !result.rowId) {
    return;
  }
  try {
    await renameCharacter(result.rowId, result.value);
    await loadData();
  } catch (error) {
    await alertDialog({ title: '重命名失败', message: (error as Error).message, danger: true });
  }
});

useIpcListener(IPC.BATCH_RENAME_CONFIRMED, async (result: PromptResult) => {
  if (!result.value) {
    return;
  }

  // 名称在同一个来源内唯一，撞名后继续执行只会重复报错，因此遇到失败即停止
  for (const id of selectedIds.value) {
    try {
      await renameCharacter(id, result.value);
    } catch (error) {
      await alertDialog({ title: '重命名失败', message: (error as Error).message, danger: true });
      break;
    }
  }
  selectedIds.value = [];
  await loadData();
});

onMounted(loadData);
</script>

<style scoped>
.character-page {
  padding: var(--page-padding);
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--app-space-10);
  margin-bottom: var(--app-space-12);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  flex: 1;
}

.table-wrap {
  flex: 1;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  height: 100%;
}

.char-name {
  cursor: pointer;
}

.char-name:hover {
  color: var(--app-primary);
  text-decoration: underline;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: var(--app-space-12) 0 var(--app-space-16) 0;
  flex-shrink: 0;
}
</style>
