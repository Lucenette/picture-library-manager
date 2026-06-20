<template>
  <div class="library-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-select v-model="galleryFilter" placeholder="按图库筛选" clearable style="width: 180px" @change="loadData">
          <el-option
            v-for="g in galleries"
            :key="g.id"
            :label="g.name"
            :value="g.id"
          />
        </el-select>

        <el-select v-model="characterFilter" placeholder="按角色筛选" clearable style="width: 180px; margin-left: 8px" @change="loadData">
          <el-option
            v-for="c in characters"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
      </div>

      <div class="toolbar-right">
        <el-button type="danger" @click="batchDelete" :disabled="selectedIds.length === 0">
          删除选中 ({{ selectedIds.length }})
        </el-button>
        <el-button type="success" @click="exportImages" :disabled="processedImages.length === 0">
          <el-icon><Download /></el-icon> 导出
        </el-button>
      </div>
    </div>

    <div class="table-wrap">
    <el-table
      :data="pagedImages"
      style="width: 100%"
      @selection-change="onSelectionChange"
      @sort-change="onSortChange"
      row-key="id"
      v-loading="exporting"
    >
      <el-table-column type="selection" width="45" />
      <el-table-column label="预览" width="90">
        <template #default="{ row }">
          <img
            :src="'file://' + row.selectedFile"
            style="width: 70px; height: 70px; object-fit: cover; border-radius: 4px"
          />
        </template>
      </el-table-column>
      <el-table-column prop="characterName" label="角色" width="160" sortable="custom" />
      <el-table-column prop="selectedFileName" label="文件名" min-width="220" show-overflow-tooltip sortable="custom" />
      <el-table-column prop="scriptName" label="处理脚本" width="150" sortable="custom">
        <template #default="{ row }">
          {{ row.scriptName || '手动确认' }}
        </template>
      </el-table-column>
      <el-table-column prop="confirmedAt" label="确认时间" width="170" sortable="custom" />
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text type="danger" @click="deleteOne(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-pagination
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]"
      :total="sortedImages.length"
      layout="total, sizes, prev, pager, next, jumper"
      class="pager"
    />

    <!-- 导出进度 -->
    <el-dialog v-model="exportProgressVisible" title="导出进度" width="400px" :close-on-click-modal="false">
      <el-progress :percentage="exportPercent" />
      <p style="margin-top: 12px">
        已导出 {{ exportedCount }} / {{ totalExportCount }}，错误 {{ exportErrorCount }}
      </p>
      <template #footer>
        <el-button @click="exportProgressVisible = false" :disabled="exporting">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Download } from '@element-plus/icons-vue';
import {
  getAllProcessedImages,
  deleteProcessedImage,
  getAllGalleries,
  getCharactersByGallery,
} from '@/db/database';
import type { ProcessedImageView, Gallery, Character } from '@common/types';

/** 所有 processed_image 记录 */
const processedImages = ref<ProcessedImageView[]>([]);
const selectedIds = ref<number[]>([]);
const galleryFilter = ref<number | undefined>(undefined);
const characterFilter = ref<number | undefined>(undefined);
const galleries = ref<Gallery[]>([]);
const characters = ref<Character[]>([]);

/** 导出状态 */
const exporting = ref(false);
const exportProgressVisible = ref(false);
const exportPercent = ref(0);
const exportedCount = ref(0);
const totalExportCount = ref(0);
const exportErrorCount = ref(0);

// ============================================================
// 方法
// ============================================================

const page = ref(1);
const pageSize = ref(20);
const libSortProp = ref<string | null>(null);
const libSortOrder = ref<'ascending' | 'descending' | null>(null);

function onSortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  libSortProp.value = prop;
  libSortOrder.value = order as 'ascending' | 'descending' | null;
}

const sortedImages = computed(() => {
  const prop = libSortProp.value;
  const order = libSortOrder.value;
  if (!prop || !order) {
    // 默认：按角色名称升序
    return [...processedImages.value].sort((a, b) => a.characterName.localeCompare(b.characterName));
  }
  const dir = order === 'ascending' ? 1 : -1;
  return [...processedImages.value].sort((a, b) => {
    const va = (a as any)[prop] ?? '';
    const vb = (b as any)[prop] ?? '';
    return String(va).localeCompare(String(vb)) * dir;
  });
});

const pagedImages = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return sortedImages.value.slice(start, start + pageSize.value);
});

async function loadData(): Promise<void> {
  processedImages.value = await getAllProcessedImages(galleryFilter.value, characterFilter.value);
  galleries.value = await getAllGalleries();
  if (galleryFilter.value) {
    characters.value = await getCharactersByGallery(galleryFilter.value);
  } else {
    characters.value = [];
  }
}

function onSelectionChange(rows: ProcessedImageView[]): void {
  selectedIds.value = rows.map((r) => r.id);
}

/** 删除单条记录 */
async function deleteOne(row: ProcessedImageView): Promise<void> {
  if (!confirm(`确定删除「${row.characterName} - ${row.selectedFileName}」？\n（不会删除原始文件）`)) return;
  await deleteProcessedImage(row.id);
  await loadData();
}

/** 批量删除 */
async function batchDelete(): Promise<void> {
  if (selectedIds.value.length === 0) return;
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 条记录？\n（不会删除原始文件）`)) return;
  for (const id of selectedIds.value) { await deleteProcessedImage(id); }
  selectedIds.value = [];
  await loadData();
}

/**
 * 导出图片到指定目录
 * 目标结构：{目标目录}/{角色名}/{角色名}_{0001}.{扩展名}
 */
async function exportImages(): Promise<void> {
  const targetDir = prompt('请输入导出目标目录的绝对路径：');
  if (!targetDir) return;

  const fs = require('fs');
  const path = require('path');

  if (!fs.existsSync(targetDir)) {
    if (!confirm(`目录「${targetDir}」不存在，是否创建？`)) return;
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const allImages = await getAllProcessedImages();
  if (allImages.length === 0) return;

  exporting.value = true;
  exportProgressVisible.value = true;
  exportedCount.value = 0;
  totalExportCount.value = allImages.length;
  exportErrorCount.value = 0;
  exportPercent.value = 0;

  // 按角色分组计数（用于序号）
  const charCounters: Record<string, number> = {};
  let i = 0;

  function next(): void {
    if (i >= allImages.length) {
      exporting.value = false;
      alert(`导出完成！\n成功: ${exportedCount.value}, 错误: ${exportErrorCount.value}`);
      return;
    }

    const img = allImages[i];
    i++;

    try {
      const charName = img.characterName;
      if (!charCounters[charName]) {
        charCounters[charName] = 0;
      }
      charCounters[charName]++;

      const ext = path.extname(img.selectedFile);
      const newName = `${charName}_${String(charCounters[charName]).padStart(4, '0')}${ext}`;
      const charDir = path.join(targetDir, charName);
      const destPath = path.join(charDir, newName);

      if (!fs.existsSync(charDir)) {
        fs.mkdirSync(charDir, { recursive: true });
      }

      fs.copyFileSync(img.selectedFile, destPath);
      exportedCount.value++;
    } catch (e: any) {
      exportErrorCount.value++;
      console.error(`导出失败 [${img.selectedFile}]: ${e.message}`);
    }

    exportPercent.value = Math.round((i / allImages.length) * 100);
    setTimeout(next, 50);
  }

  setTimeout(next, 50);
}

onMounted(loadData);
</script>

<style scoped>
.library-page {
  padding: 0 24px;
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
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.table-wrap {
  flex: 1;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  height: 100%;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 16px 0;
  flex-shrink: 0;
}
</style>
