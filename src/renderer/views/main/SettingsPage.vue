<template>
  <div class="settings-page">
    <template v-if="snapshot">
      <section class="group">
        <h2 class="group-title">界面</h2>
        <div class="row">
          <div class="row-text">
            <span class="row-label">外观主题</span>
            <span class="row-hint">立即生效：所有已打开的窗口一起换，不需要重启</span>
          </div>
          <el-radio-group
            :model-value="snapshot.settings.theme"
            :disabled="saving"
            @change="changeTheme"
          >
            <el-radio-button v-for="option in THEME_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </section>

      <section class="group">
        <h2 class="group-title">日志</h2>
        <div class="row">
          <div class="row-text">
            <span class="row-label">日志级别</span>
            <span class="row-hint">需重启：启动时就把级别固化了，所以只能看、不能在这里改</span>
          </div>
          <div class="row-value">
            <span class="value">{{ snapshot.info.logLevel }}</span>
            <span class="origin">来自 {{ snapshot.info.logLevelSource }}</span>
          </div>
        </div>
      </section>

      <p class="footnote">
        设置文件 <code class="path">{{ snapshot.info.filePath }}</code>：手改它与在这里改等价，重启后生效；
        在界面上改过之后文件会重新排版，手写的注释不会保留。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';

import { IPC } from '@common/ipcChannels';
import { THEME_OPTIONS, isThemeName, type Settings, type SettingsSnapshot } from '@common/settings';

import { useIpcListener } from '@/composables/useIpcListener';
import { createLogger } from '@/services/log-service';
import { getSettingsSnapshot, updateSettings } from '@/services/settings-service';

/** 本模块的日志（category `renderer.settings`） */
const log = createLogger('settings');

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

/** 主进程给的快照（设置 + 只读信息）：界面只展示它，不自己猜当前值 */
const snapshot = ref<SettingsSnapshot | null>(null);

/** 正在提交：写盘完成前锁住控件，避免连点出两次改动 */
const saving = ref(false);

// ------------------------------------------------------------
// 方法
// ------------------------------------------------------------

/** 读一次快照 */
async function load(): Promise<void> {
  try {
    snapshot.value = await getSettingsSnapshot();
  } catch (error) {
    log.error('failed to load settings', error);
    ElMessage.error('读取设置失败，详见日志');
  }
}

/**
 * 提交改动。
 *
 * **不做乐观更新**：成功与失败都以主进程回话里的设置为准，否则会出现「界面换了、文件没换」。
 * 跨窗口的生效由主进程广播负责（见 entries/shell/theme.ts），这一页只管自己显示的是不是真值。
 */
async function submit(patch: Partial<Settings>): Promise<void> {
  saving.value = true;
  try {
    const result = await updateSettings(patch);
    replaceSettings(result.settings);
    if (!result.ok) {
      ElMessage.error(result.errors.join('；'));
    }
  } catch (error) {
    log.error('failed to update settings', error);
    ElMessage.error('设置提交失败，详见日志');
  } finally {
    saving.value = false;
  }
}

/** 只换设置那一半：只读信息（文件路径、日志级别）不随改动变 */
function replaceSettings(settings: Settings): void {
  const current = snapshot.value;
  if (current !== null) {
    snapshot.value = { settings, info: current.info };
  }
}

/** 单选组的取值由组件库给回，类型上是宽泛的联合：只认已知主题，与主进程校验的是同一份 */
function changeTheme(value: unknown): void {
  if (!isThemeName(value)) {
    return;
  }
  void submit({ theme: value });
}

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

// 别处改了设置也要跟上（以后的入口、或主进程自己动手）：这一页显示的始终是真源，而不是点过的那个值
useIpcListener<[Settings]>(IPC.SETTINGS_CHANGED, (settings) => {
  replaceSettings(settings);
});

onMounted(load);
</script>

<style scoped>
.settings-page {
  padding: var(--page-padding);
  display: flex;
  flex-direction: column;
  gap: var(--app-space-16);
  /* 一行一条设置项，宽屏下不要拉成一条长横线 */
  max-width: 720px;
}

.group {
  padding: var(--app-space-16);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-8);
  background: var(--app-bg-surface);
}

.group-title {
  margin-bottom: var(--app-space-12);
  color: var(--app-text-primary);
  font-size: var(--app-font-md);
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-space-16);
}

.row-text {
  display: flex;
  flex-direction: column;
  gap: var(--app-space-2);
  min-width: 0;
}

.row-label {
  color: var(--app-text-regular);
  font-size: var(--app-font-base);
}

.row-hint,
.origin {
  color: var(--app-text-muted);
  font-size: var(--app-font-sm);
}

.row-value {
  display: flex;
  align-items: baseline;
  gap: var(--app-space-8);
  flex: none;
}

.value {
  color: var(--app-text-primary);
  font-size: var(--app-font-base);
}

.footnote {
  color: var(--app-text-muted);
  font-size: var(--app-font-sm);
  line-height: 1.6;
}

.path {
  padding: 0 var(--app-space-4);
  border-radius: var(--app-radius-4);
  background: var(--app-bg-header);
  color: var(--app-text-secondary);
  /* 用户目录的路径可能很长：允许断行，别把整页撑出横向滚动 */
  word-break: break-all;
}
</style>
