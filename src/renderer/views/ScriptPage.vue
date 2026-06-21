<template>
  <div class="script-page">
    <div class="toolbar">
      <el-button type="primary" @click="addScript">
        <el-icon><Plus /></el-icon> 加载脚本文件
      </el-button>
      <el-button @click="batchReload" :disabled="selectedIds.length === 0">
        批量重载 ({{ selectedIds.length }})
      </el-button>
      <el-button type="danger" @click="batchDelete" :disabled="selectedIds.length === 0">
        批量删除 ({{ selectedIds.length }})
      </el-button>
    </div>

    <div class="table-wrap">
      <el-table
        :data="pagedScripts"
        @sort-change="onSortChange"
        @selection-change="onSelectionChange"
        row-key="id"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column prop="name" label="名称" width="160" sortable="custom" show-overflow-tooltip />
        <el-table-column prop="filePath" label="文件路径" min-width="250" sortable="custom" show-overflow-tooltip />
        <el-table-column label="类型" width="180">
          <template #default="{ row }">
            <el-tag v-for="t in row.types" :key="t" size="small" :type="tagType(t)" style="margin-right:4px">{{ typeLabel(t) }}</el-tag>
            <span v-if="!row.types?.length" style="color:#5e6065">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="brief" label="代码" min-width="260" show-overflow-tooltip />
        <el-table-column prop="loadedAt" label="加载时间" width="170" sortable="custom" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="startRename(row)">重命名</el-button>
            <el-button size="small" text @click="reloadScript(row)">重载</el-button>
            <el-button size="small" text type="danger" @click="removeScript(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="sortedScripts.length"
        layout="total, sizes, prev, pager, next, jumper"
      />
    </div>

    <el-dialog v-model="renameVisible" title="重命名脚本" width="400px">
      <el-input v-model="renameName" placeholder="新名称" @keyup.enter="doRename" />
      <template #footer>
        <el-button @click="renameVisible = false">取消</el-button>
        <el-button type="primary" @click="doRename">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import {
  getAllScripts,
  upsertScript,
  reloadScript as dbReload,
  deleteScript,
  renameScript,
} from '@/db/database';
import type { ProcessScript } from '@common/types';

const scripts = ref<ProcessScript[]>([]);
const selectedIds = ref<number[]>([]);
const page = ref(1);
const pageSize = ref(20);

// 排序
const sortProp = ref<string | null>(null);
const sortOrder = ref<'ascending' | 'descending' | null>(null);

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sortProp.value = prop;
  sortOrder.value = order as 'ascending' | 'descending' | null;
}

const sortedScripts = computed(() => {
  const prop = sortProp.value;
  const order = sortOrder.value;
  if (!prop || !order) {
    return [...scripts.value].sort((a, b) => a.name.localeCompare(b.name));
  }
  const dir = order === 'ascending' ? 1 : -1;
  return [...scripts.value].sort((a, b) => {
    const va = (a as any)[prop] ?? '';
    const vb = (b as any)[prop] ?? '';
    return String(va).localeCompare(String(vb)) * dir;
  });
});

const pagedScripts = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedScripts.value.slice(start, start + pageSize.value);
});

// 重命名
const renameVisible = ref(false);
const renameId = ref<number | null>(null);
const renameName = ref('');

function startRename(script: ProcessScript): void {
  renameId.value = script.id;
  renameName.value = script.name;
  renameVisible.value = true;
}

async function doRename(): Promise<void> {
  if (!renameId.value || !renameName.value.trim()) return;
  await renameScript(renameId.value, renameName.value.trim());
  renameVisible.value = false;
  await loadData();
}

async function loadData(): Promise<void> {
  scripts.value = await getAllScripts();
}

async function addScript(): Promise<void> {
  const { ipcRenderer } = require('electron');
  const paths: string[] = await ipcRenderer.invoke('dialog:openScript');
  if (!paths || paths.length === 0) return;
  const fs = require('fs');
  const path = require('path');
  for (const filePath of paths) {
    const code = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath);
    await upsertScript(name, filePath, code);
  }
  scripts.value = await getAllScripts();
}

async function reloadScript(script: ProcessScript): Promise<void> {
  const fs = require('fs');
  try {
    const code = fs.readFileSync(script.filePath, 'utf-8');
    await dbReload(script.filePath, code);
    scripts.value = await getAllScripts();
  } catch (e: any) { alert(`重载失败: ${e.message}`); }
}

function onSelectionChange(rows: ProcessScript[]): void {
  selectedIds.value = rows.map(r => r.id);
}

async function batchReload(): Promise<void> {
  const fs = require('fs');
  const targets = scripts.value.filter(s => selectedIds.value.includes(s.id));
  for (const s of targets) {
    try {
      const code = fs.readFileSync(s.filePath, 'utf-8');
      await dbReload(s.filePath, code);
    } catch (e: any) { console.error(`重载失败 [${s.name}]:`, e.message); }
  }
  scripts.value = await getAllScripts();
}

async function batchDelete(): Promise<void> {
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 个脚本？`)) return;
  for (const id of selectedIds.value) { await deleteScript(id); }
  scripts.value = await getAllScripts();
}

async function removeScript(script: ProcessScript): Promise<void> {
  if (!confirm(`确定删除脚本「${script.name}」？`)) return;
  await deleteScript(script.id);
  scripts.value = await getAllScripts();
}

function tagType(t: string): 'success' | 'warning' | 'info' | 'danger' | '' {
  const map: Record<string, any> = { 'select-image': 'success', 'identify-character': 'warning', 'identify-structure': 'danger' };
  return map[t] || '';
}
function typeLabel(t: string): string {
  const map: Record<string, string> = { 'select-image': '图片', 'identify-character': '角色', 'identify-structure': '结构' };
  return map[t] || t;
}

onMounted(loadData);
</script>

<style scoped>
.script-page {
  padding: 0 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toolbar { margin-bottom: 12px; flex-shrink: 0; }
.table-wrap { flex: 1; overflow: hidden; }
.table-wrap :deep(.el-table) { height: 100%; }
.code-line {
  display: inline-block; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: #a0a3a9;
}
.pager { display: flex; justify-content: flex-end; padding: 12px 0 16px 0; flex-shrink: 0; }
</style>
