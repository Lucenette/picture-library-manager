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
        <el-table-column prop="galleryName" label="图库" width="160" sortable="custom" />
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
import { computed, onMounted, ref } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { Character, Gallery, PromptInitData, PromptResult } from '@common/types';
import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterSection } from '@/components/CategorySearch.types';
import { useFilterOrder } from '@/composables/useFilterOrder';
import { useIpcListener } from '@/composables/useIpcListener';
import { getAllGalleries, getCharactersByGallery, renameCharacter } from '@/db/database';

/** 列表行：角色实体 + 所属图库名 */
type CharacterRow = Character & { galleryName: string };

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const characters = ref<CharacterRow[]>([]);
const galleries = ref<Gallery[]>([]);
const selectedIds = ref<number[]>([]);

const page = ref(1);
const pageSize = ref(20);
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

const galleryFilter = ref<number | undefined>(undefined);
const nameFilter = ref('');
const pathFilter = ref('');

const { order: filterOrder, activate: activateFilter, deactivate: deactivateFilter } = useFilterOrder(() => {
  page.value = 1;
});

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const galleryItems = computed(() =>
  galleries.value.map((gallery) => ({ label: gallery.name, value: String(gallery.id) })),
);

const filteredCharacters = computed(() => {
  let list = characters.value;

  if (galleryFilter.value) {
    list = list.filter((item) => item.galleryId === galleryFilter.value);
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
      (a, b) => a.galleryName.localeCompare(b.galleryName) || a.name.localeCompare(b.name),
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
    key: 'gallery',
    label: '图库',
    value: galleryFilter.value ? String(galleryFilter.value) : '',
    display: galleries.value.find((gallery) => gallery.id === galleryFilter.value)?.name ?? '',
    items: galleryItems.value,
    onSelect: (value: string) => {
      galleryFilter.value = Number(value);
      activateFilter('gallery');
    },
    onClear: () => {
      galleryFilter.value = undefined;
      deactivateFilter('gallery');
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
  galleries.value = await getAllGalleries();

  const rows: CharacterRow[] = [];
  for (const gallery of galleries.value) {
    const galleryCharacters = await getCharactersByGallery(gallery.id);
    for (const character of galleryCharacters) {
      rows.push({ ...character, galleryName: gallery.name });
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
  ipcRenderer.invoke(IPC.PROMPT_OPEN, payload);
}

function openBatchRename(): void {
  const first = characters.value.find((character) => selectedIds.value.includes(character.id));
  const payload: PromptInitData = {
    title: '批量重命名',
    placeholder: '输入新角色名',
    value: first?.name ?? '',
    channel: IPC.BATCH_RENAME_CONFIRMED,
  };
  ipcRenderer.invoke(IPC.PROMPT_OPEN, payload);
}

useIpcListener(IPC.SINGLE_RENAME_CONFIRMED, async (result: PromptResult) => {
  if (!result.value || !result.rowId) {
    return;
  }
  try {
    await renameCharacter(result.rowId, result.value);
    await loadData();
  } catch (error) {
    alert(`重命名失败：${(error as Error).message}`);
  }
});

useIpcListener(IPC.BATCH_RENAME_CONFIRMED, async (result: PromptResult) => {
  if (!result.value) {
    return;
  }

  // 名称在同一个图库内唯一，撞名后继续执行只会重复报错，因此遇到失败即停止
  for (const id of selectedIds.value) {
    try {
      await renameCharacter(id, result.value);
    } catch (error) {
      alert(`重命名失败：${(error as Error).message}`);
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
  padding: 0 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
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
  color: #3871e1;
  text-decoration: underline;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
