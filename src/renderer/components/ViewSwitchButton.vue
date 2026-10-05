<template>
  <el-tooltip :content="tooltip" placement="top">
    <el-button class="view-switch" text @click="emit('toggle')">
      <el-icon :size="18">
        <Grid v-if="mode === 'list'" />
        <List v-else />
      </el-icon>
    </el-button>
  </el-tooltip>
</template>

<script setup lang="ts">
import { Grid, List } from '@element-plus/icons-vue';
import { computed } from 'vue';

import type { ViewMode } from '@/composables/useViewMode';

const props = defineProps<{ mode: ViewMode }>();
const emit = defineEmits<{ toggle: [] }>();

/** 图标与提示都描述「点下去会切到什么」，与文件管理器的习惯一致 */
const tooltip = computed(() => (props.mode === 'list' ? '切到平铺' : '切到列表'));
</script>

<style scoped>
.view-switch {
  padding: var(--app-space-6) var(--app-space-8);
}
</style>
