<template>
  <div class="character-page">
    <div class="toolbar">
      <div class="toolbar-left">
        <CategorySearch :sections="filterSections" :order="filterOrder" />
      </div>
      <el-button type="primary" @click="showBatchRename = true" :disabled="selectedIds.length === 0">
        批量重命名 ({{ selectedIds.length }})
      </el-button>
    </div>

    <div class="table-wrap">
      <el-table :data="pagedChars" row-key="id" @sort-change="onSortChange" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="45" />
        <el-table-column prop="galleryName" label="图库" width="160" sortable="custom" />
        <el-table-column prop="name" label="角色名" min-width="200" sortable="custom">
          <template #default="{ row }">
            <template v-if="editId === row.id">
              <el-input v-model="editName" size="small" @keyup.enter="saveRename(row)" @blur="saveRename(row)" ref="editInput" />
            </template>
            <span v-else @dblclick="startEdit(row)" class="char-name">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="sourcePath" label="源路径" min-width="300" show-overflow-tooltip />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="startEdit(row)">重命名</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="filteredChars.length"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>
    <el-dialog v-model="showBatchRename" title="批量重命名" width="400px">
      <el-input v-model="batchPattern" placeholder="输入新角色名（将应用到所有选中角色）" />
      <template #footer>
        <el-button @click="showBatchRename = false">取消</el-button>
        <el-button type="primary" @click="doBatchRename" :disabled="!batchPattern.trim()">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import CategorySearch from '@/components/CategorySearch.vue';
import type { FilterSection } from '@/components/CategorySearch.types';
import { getAllGalleries, getCharactersByGallery, renameCharacter } from '@/db/database';
import type { Character, Gallery } from '@common/types';

const chars = ref<(Character & { galleryName: string })[]>([]);
const galleries = ref<Gallery[]>([]);
const page = ref(1);
const pageSize = ref(20);
const filterOrder = ref<string[]>([]);
const galleryFilter = ref<number | undefined>(undefined);
const nameFilter = ref<string>('');
const pathFilter = ref<string>('');

// 排序
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop; sortOrder.value = order as 'ascending' | 'descending' | null;
}

// 编辑
const editId = ref<number | null>(null);
const editName = ref('');
const selectedIds = ref<number[]>([]);
const showBatchRename = ref(false);
const batchPattern = ref('');
const editInput = ref<any>(null);

function onSelectionChange(rows: any[]): void {
  selectedIds.value = rows.map(r => r.id);
}

function startEdit(row: Character & { galleryName: string }): void {
  editId.value = row.id;
  editName.value = row.name;
  nextTick(() => editInput.value?.focus());
}

async function saveRename(row: Character & { galleryName: string }): Promise<void> {
  if (editId.value !== row.id) return;
  const newName = editName.value.trim();
  if (newName && newName !== row.name) {
    await renameCharacter(row.id, newName);
    row.name = newName;
  }
  editId.value = null;
}

// 筛选
const filteredChars = computed(() => {
  let list = chars.value;
  if (galleryFilter.value) list = list.filter(c => c.galleryId === galleryFilter.value);
  if (nameFilter.value) { const kw = nameFilter.value.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(kw)); }
  if (pathFilter.value) { const kw = pathFilter.value.toLowerCase(); list = list.filter(c => c.sourcePath.toLowerCase().includes(kw)); }
  const prop = sortProp.value as keyof typeof list[0] | null;
  const order = sortOrder.value;
  if (prop && order) {
    const dir = order === 'ascending' ? 1 : -1;
    list = [...list].sort((a, b) => String(a[prop] ?? '').localeCompare(String(b[prop] ?? '')) * dir);
  } else {
    list = [...list].sort((a, b) => a.galleryName.localeCompare(b.galleryName) || a.name.localeCompare(b.name));
  }
  return list;
});

const pagedChars = computed(() => filteredChars.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

const galleryItems = computed(() => galleries.value.map(g => ({ label: g.name, value: String(g.id) })));
const filterSections = computed<FilterSection[]>(() => [
  { key: 'gallery', label: '图库', value: galleryFilter.value ? String(galleryFilter.value) : '', display: galleryFilter.value ? galleries.value.find(g => g.id === galleryFilter.value)?.name || '' : '', items: galleryItems.value, onSelect: (v: string) => { galleryFilter.value = Number(v); page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'gallery'), 'gallery']; }, onClear: () => { galleryFilter.value = undefined; page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'gallery'); } },
  { key: 'name', label: '角色名', value: nameFilter.value, display: nameFilter.value || '', items: [], onSelect: (v: string) => { nameFilter.value = v; page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'name'), 'name']; }, onClear: () => { nameFilter.value = ''; page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'name'); } },
  { key: 'path', label: '源路径', value: pathFilter.value, display: pathFilter.value || '', items: [], onSelect: (v: string) => { pathFilter.value = v; page.value = 1; filterOrder.value = [...filterOrder.value.filter(k => k !== 'path'), 'path']; }, onClear: () => { pathFilter.value = ''; page.value = 1; filterOrder.value = filterOrder.value.filter(k => k !== 'path'); } },
]);

async function doBatchRename(): Promise<void> {
  const name = batchPattern.value.trim();
  if (!name || selectedIds.value.length === 0) return;
  for (const id of selectedIds.value) await renameCharacter(id, name);
  showBatchRename.value = false;
  batchPattern.value = '';
  selectedIds.value = [];
  await loadData();
}

async function loadData(): Promise<void> {
  galleries.value = await getAllGalleries();
  const all: (Character & { galleryName: string })[] = [];
  for (const g of galleries.value) {
    const gChars = await getCharactersByGallery(g.id);
    for (const c of gChars) all.push({ ...c, galleryName: g.name });
  }
  chars.value = all;
}

onMounted(loadData);
</script>

<style scoped>
.character-page { padding: 0 24px; height: 100%; display: flex; flex-direction: column; }
.toolbar { display: flex; margin-bottom: 12px; flex-shrink: 0; gap: 10px; align-items: center; }
.toolbar-left { display: flex; align-items: center; flex: 1; }
.table-wrap { flex: 1; overflow: hidden; }
.table-wrap :deep(.el-table) { height: 100%; }
.char-name { cursor: pointer; }
.char-name:hover { color: #3871e1; text-decoration: underline; }
.pager { display: flex; justify-content: flex-end; padding: 12px 0 16px 0; flex-shrink: 0; }
</style>
