<template>
  <router-view v-if="isPopup" />

  <el-container v-else class="app-container">
    <el-header class="app-header">
      <div class="header-wrap">
        <el-menu :default-active="activeMenu" mode="horizontal" router class="app-menu">
          <el-menu-item index="/">
            <el-icon><FolderOpened /></el-icon>
            <span>图库管理</span>
          </el-menu-item>
          <el-menu-item index="/characters">
            <el-icon><User /></el-icon>
            <span>角色确认</span>
          </el-menu-item>
          <el-menu-item index="/process">
            <el-icon><Grid /></el-icon>
            <span>图组确认</span>
          </el-menu-item>
          <el-menu-item index="/library">
            <el-icon><PictureFilled /></el-icon>
            <span>图库导出</span>
          </el-menu-item>
        </el-menu>

        <router-link
          to="/tasks"
          class="header-scripts-link"
          :class="{ active: activeMenu === '/tasks' }"
        >
          <el-icon><List /></el-icon>
          <span>任务管理</span>
          <span v-if="activeTaskCount > 0" class="task-badge">{{ activeTaskCount }}</span>
        </router-link>

        <router-link
          to="/scripts"
          class="header-scripts-link"
          :class="{ active: activeMenu === '/scripts' }"
        >
          <el-icon><Setting /></el-icon>
          <span>脚本管理</span>
        </router-link>
      </div>
    </el-header>

    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { FolderOpened, Grid, List, PictureFilled, Setting, User } from '@element-plus/icons-vue';
import { useTasks } from '@/composables/useTasks';

/** 这些路由不套主窗口的导航骨架：独立子窗口，以及启动阶段的迁移页 */
const POPUP_ROUTES = [
  '/viewer', '/scan-config', '/batch-process', '/confirm', '/prompt', '/file-viewer', '/popup', '/similar',
  '/loading',
];

const route = useRoute();
const isPopup = computed(() => POPUP_ROUTES.includes(route.path));
const activeMenu = computed(() => route.path);

// 只有主界面需要任务角标：迁移页在主进程注册任务通道之前就已加载，那时拉列表必然失败
const tasks = isPopup.value ? null : useTasks();
const activeTaskCount = computed(() => {
  if (!tasks) {
    return 0;
  }
  return tasks.runningCount.value + tasks.pendingCount.value;
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, 'Microsoft YaHei', sans-serif;
}

.app-container {
  height: 100vh;
}

.app-header {
  padding: 0;
  border-bottom: 1px solid #e4e7ed;
}

.header-wrap {
  display: flex;
  align-items: center;
  height: 100%;
}

.app-menu {
  border-bottom: none !important;
  flex: 1;
}

.header-scripts-link {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 20px;
  height: 100%;
  text-decoration: none;
  color: #a0a3a9;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.header-scripts-link:hover {
  color: #d8dadd;
}

.header-scripts-link.active {
  color: #3871e1;
  border-bottom-color: #3871e1;
}

.task-badge {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 9px;
  background: #3871e1;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
}

.app-main {
  background: #1e1f22;
  height: calc(100vh - 60px);
  overflow-y: auto;
  padding: 16px 0 0 0;
}
</style>
