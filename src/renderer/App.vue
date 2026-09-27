<template>
  <router-view v-if="isPopup" />

  <el-container v-else class="app-container">
    <div class="title-bar">
      <div v-if="!isMac" class="title-bar-icon">
        <img :src="appIcon" alt="" />
      </div>
      <span class="title-bar-text">角色图库管理器</span>
    </div>

    <div class="app-body">
      <nav v-if="!isLoading" class="app-rail">
        <div
          v-for="(item, index) in NAV_ITEMS"
          :key="item.path"
          class="rail-slot"
          :class="{ 'is-bottom-start': index === bottomStartIndex }"
        >
          <el-tooltip :content="item.label" placement="right" :show-after="300">
            <router-link :to="item.path" class="rail-link" :class="{ active: activeMenu === item.path }">
              <el-icon><component :is="item.icon" /></el-icon>
              <span v-if="item.badge && activeTaskCount > 0" class="task-badge">{{ activeTaskCount }}</span>
            </router-link>
          </el-tooltip>
        </div>
      </nav>

      <el-main class="app-main" :class="{ 'is-loading': isLoading }">
        <router-view />
      </el-main>
    </div>
  </el-container>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
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

/** 导航栏一项：40px 宽的栏放不下文字，名称走 tooltip */
interface NavItem {
  path: string;
  label: string;
  icon: Component;
  /** 任务管理要在图标右上角挂运行中的数量 */
  badge?: boolean;
  /** 贴到栏底（脚本与任务），最后一项在最下面 */
  bottom?: boolean;
}

/** 左侧导航栏，顺序即视觉顺序：上面是数据流的四个页面，脚本与任务贴底 */
const NAV_ITEMS: NavItem[] = [
  { path: '/', label: '来源管理', icon: FolderOpened },
  { path: '/characters', label: '角色管理', icon: User },
  { path: '/process', label: '图组管理', icon: Grid },
  { path: '/library', label: '图库', icon: PictureFilled },
  { path: '/scripts', label: '脚本管理', icon: Setting, bottom: true },
  { path: '/tasks', label: '任务管理', icon: List, badge: true, bottom: true },
];

/** 栏底那组的起点：它上面撑开弹性空白，把这组顶到底部 */
const bottomStartIndex = NAV_ITEMS.findIndex((item) => item.bottom === true);

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

/* 失焦：整条 chrome（标题栏 + 左侧导航栏）一起压暗，与系统窗口按钮同一档。
   导航栏压的是 link 而不是 .app-rail——底色不跟着淡，否则和标题栏的底色会在接缝处对不齐 */
.window-blurred .title-bar-icon,
.window-blurred .rail-link {
  opacity: 0.5;
}

.window-blurred .title-bar-text {
  color: var(--el-text-color-disabled);
}

/* 标题栏下面那一条：左边 40px 导航栏，右边内容区 */
.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* 导航栏：40px 宽、图标竖排；文字放不下，名称由 tooltip 给 */
.app-rail {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 40px;
  background: #26282c;
  border-right: 1px solid #323438;
}

.rail-slot {
  flex: none;
}

/* 栏底那一组（脚本、任务）靠一段弹性空白顶到最下面 */
.rail-slot.is-bottom-start {
  margin-top: auto;
}

.rail-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  font-size: 18px;
  color: #a0a3a9;
  text-decoration: none;
  border-left: 2px solid transparent;
  transition: color 0.2s, background-color 0.2s, border-color 0.2s;
}

.rail-link:hover {
  color: #d8dadd;
  background: #2b2d30;
}

/* 激活态：左边一道竖条 + 提亮 */
.rail-link.active {
  color: #3871e1;
  background: #2b2d30;
  border-left-color: #3871e1;
}

/* 任务角标：贴在图标右上角 */
.task-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  padding: 0 4px;
  border-radius: 8px;
  background: #3871e1;
  color: #fff;
  font-size: 10px;
  line-height: 14px;
}

.app-main {
  background: #1e1f22;
  flex: 1;
  /* 横排里的 flex 项要显式允许收缩，否则宽表格会把整页撑出横向滚动 */
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 0 0 0;
}

/* 迁移页自带 60px 页头，让它从主区域顶部铺开 */
.app-main.is-loading {
  padding: 0;
}
</style>
