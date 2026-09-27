<template>
  <div class="script-side">
    <div class="side-actions">
      <el-button size="small" type="primary" @click="emit('create')">新增脚本</el-button>
      <el-button size="small" @click="emit('import')">加载文件</el-button>
      <el-button size="small" @click="emit('refresh')">全部重新检测</el-button>
    </div>

    <div class="side-list">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="side-item"
        :class="{ active: item.key === activeKey }"
        @click="emit('select', item.key)"
      >
        <span class="side-name">{{ item.name }}</span>
        <span v-if="item.dirty" class="side-flag is-dirty" title="有未保存的修改">●</span>
        <span v-else-if="item.broken" class="side-flag is-broken" title="编译失败或文件缺失">!</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  items: { key: string; name: string; dirty: boolean; broken: boolean }[];
  activeKey: string;
}>();

const emit = defineEmits<{
  (event: 'select', key: string): void;
  (event: 'create'): void;
  (event: 'import'): void;
  (event: 'refresh'): void;
}>();
</script>

<style scoped>
.script-side {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 220px;
  min-height: 0;
  border-right: 1px solid var(--el-border-color);
}

.side-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid var(--el-border-color);
}

.side-actions .el-button + .el-button {
  margin-left: 0;
}

.side-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0;
}

.side-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px 7px 8px;
  border: none;
  border-left: 2px solid transparent;
  background: none;
  color: var(--el-text-color-regular);
  font-size: 13px;
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

.side-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.side-flag {
  flex: none;
  font-size: 12px;
}

.side-flag.is-dirty {
  color: var(--el-color-primary);
}

.side-flag.is-broken {
  color: var(--el-color-danger);
}
</style>
