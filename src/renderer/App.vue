<template>
  <router-view v-if="isViewer" />
  <el-container v-else class="app-container">
    <el-header class="app-header">
      <el-menu
        :default-active="activeMenu"
        mode="horizontal"
        router
        class="app-menu"
      >
        <el-menu-item index="/">
          <el-icon><FolderOpened /></el-icon>
          <span>图库管理</span>
        </el-menu-item>
        <el-menu-item index="/process">
          <el-icon><Select /></el-icon>
          <span>处理确认</span>
        </el-menu-item>
        <el-menu-item index="/library">
          <el-icon><PictureFilled /></el-icon>
          <span>准图库</span>
        </el-menu-item>
      </el-menu>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { FolderOpened, Select, PictureFilled } from '@element-plus/icons-vue';

const route = useRoute();
const activeMenu = computed(() => route.path);
const isViewer = computed(() => route.path === '/viewer');
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

.app-menu {
  border-bottom: none !important;
}

.app-main {
  background: #f5f7fa;
  height: calc(100vh - 60px);
  overflow-y: auto;
  padding: 16px 0 0 0;
}
</style>
