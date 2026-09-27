<template>
  <router-view v-if="isPopup" />

  <el-container v-else class="app-container">
    <div class="title-bar">
      <div v-if="!isMac" class="title-bar-icon">
        <img :src="appIcon" alt="" />
      </div>
      <span class="title-bar-text">角色图库管理器</span>
    </div>

    <el-header v-if="!isLoading" class="app-header">
      <div class="header-wrap">
        <el-menu :default-active="activeMenu" mode="horizontal" router class="app-menu">
          <el-menu-item index="/">
            <el-icon><FolderOpened /></el-icon>
            <span>来源管理</span>
          </el-menu-item>
          <el-menu-item index="/characters">
            <el-icon><User /></el-icon>
            <span>角色管理</span>
          </el-menu-item>
          <el-menu-item index="/process">
            <el-icon><Grid /></el-icon>
            <span>图组管理</span>
          </el-menu-item>
          <el-menu-item index="/library">
            <el-icon><PictureFilled /></el-icon>
            <span>图库</span>
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

    <el-main class="app-main" :class="{ 'is-loading': isLoading }">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { FolderOpened, Grid, List, PictureFilled, Setting, User } from '@element-plus/icons-vue';
import appIcon from '@static/icon.png';
import { useTasks } from '@/composables/useTasks';

/**
 * macOS：红绿灯在左上角，那一段归系统，我们既不在标题栏放图标，也要给标题文字让开位置
 * （见样式里的 .platform-mac 与模板上的 v-if）。
 */
const isMac = navigator.platform.startsWith('Mac');
if (isMac) {
  document.documentElement.classList.add('platform-mac');
}

/**
 * 窗口失焦时整条标题栏压暗（图标与标题文字）。
 *
 * 系统窗口按钮不在这一层（Windows / Linux 的 WCO 由主进程同步改字形色，macOS 的红绿灯系统自己变灰），
 * 所以这里不需要 IPC：DOM 的 focus / blur 本来就由窗口焦点驱动，和主进程拿到的是同一个事件。
 */
function syncWindowBlurred(): void {
  document.documentElement.classList.toggle('window-blurred', !document.hasFocus());
}

window.addEventListener('focus', syncWindowBlurred);
window.addEventListener('blur', syncWindowBlurred);
syncWindowBlurred();

/** 这些路由是独立子窗口：不套主窗口的标题栏与导航骨架 */
const POPUP_ROUTES = [
  '/viewer', '/scan-config', '/batch-process', '/confirm', '/prompt', '/file-viewer', '/popup', '/similar',
];

const route = useRoute();
const isPopup = computed(() => POPUP_ROUTES.includes(route.path));
/** 启动阶段的迁移页：在主窗口里（所以有标题栏），但没有导航 */
const isLoading = computed(() => route.path === '/loading');
const activeMenu = computed(() => route.path);

// 只有主界面需要任务角标：迁移页在主进程注册任务通道之前就已加载，那时拉列表必然失败
const tasks = isPopup.value || isLoading.value ? null : useTasks();
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

:root {
  /* 自绘标题栏的高度；主进程 createMain() 的 titleBar.height 必须与它相等 */
  --title-bar-height: 40px;
}

.app-container {
  height: 100vh;
  /* el-container 的方向是靠子元素推断的，这里加了 div 之后显式写死列方向 */
  display: flex;
  flex-direction: column;
}

/* 自绘标题栏：主窗口没有系统标题栏，这一条就是它（见 window-manager 的 titleBar）。
   里面没有可点元素，所以整条都是拖拽区，不需要 no-drag */
.title-bar {
  display: flex;
  align-items: center;
  height: var(--title-bar-height);
  background: #26282c;
  -webkit-app-region: drag;
  app-region: drag;
  /* 系统按钮占的位置由 WCO 的 titlebar-area 让出来（Windows / Linux）；
     按钮在左在右都可能（RTL、用户设置），所以两边都算 */
  padding-left: env(titlebar-area-x, 0px);
  padding-right: calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%));
}

/* macOS 既没有 WCO（env(titlebar-area-*) 在那边取不到值），红绿灯又是画在网页之上的系统控件，
   所以标题文字要让开它们；那边也不画图标槽（见模板上的 v-if） */
.platform-mac .title-bar {
  padding-left: 78px;
}

.title-bar-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--title-bar-height);
  height: 100%;
}

.title-bar-icon img {
  display: block;
  width: 16px;
  height: 16px;
}

.title-bar-text {
  font-size: 13px;
  color: #a0a3a9;
  user-select: none;
}

/* 失焦：图标与文字压暗，与系统窗口按钮同一档 */
.window-blurred .title-bar-icon {
  opacity: 0.5;
}

.window-blurred .title-bar-text {
  color: var(--el-text-color-disabled);
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 0 0 0;
}

/* 迁移页自带 60px 页头，让它从主区域顶部铺开 */
.app-main.is-loading {
  padding: 0;
}
</style>
