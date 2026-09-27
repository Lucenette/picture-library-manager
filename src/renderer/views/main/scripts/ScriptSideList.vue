<template>
  <div class="script-side">
    <div class="side-actions">
      <el-button size="small" type="primary" @click="emit('create')">新增脚本</el-button>
      <el-button size="small" @click="emit('import')">加载文件</el-button>
    </div>

    <div class="side-list">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="side-item"
        :class="[`is-${item.state}`, { active: item.key === activeKey }]"
        @click="emit('select', item.key)"
      >
        <span class="side-name">{{ item.name }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  /** 状态用名字颜色表示，照 IDEA 的 git 状态色：新建未保存绿、改过未保存蓝、干净默认色 */
  items: { key: string; name: string; state: 'new' | 'modified' | 'clean' }[];
  activeKey: string;
}>();

const emit = defineEmits<{
  (event: 'select', key: string): void;
  (event: 'create'): void;
  (event: 'import'): void;
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

/* 未保存：新建的绿、改动的蓝，同 IDEA 的 git 状态色 */
.side-item.is-new .side-name {
  color: var(--el-color-success);
}

.side-item.is-modified .side-name {
  color: var(--el-color-primary);
}

.side-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
