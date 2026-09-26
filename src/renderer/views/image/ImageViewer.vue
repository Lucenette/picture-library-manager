<template>
  <div class="viewer" tabindex="0" @keydown="onKey">
    <div class="viewer-toolbar">
      <span class="viewer-info">{{ index + 1 }} / {{ files.length }}</span>
      <span class="viewer-name">{{ currentFile?.relativePath }}</span>
      <span class="viewer-res">{{ currentFile?.width ?? 0 }} × {{ currentFile?.height ?? 0 }}</span>
      <span class="viewer-size">{{ formatSize(currentFile?.fileSize ?? null) }}</span>
      <span class="viewer-zoom">{{ displayZoom }}</span>
    </div>

    <div
      ref="viewerMain"
      class="viewer-main"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
      @dblclick="onDblClick"
      @click="onClick"
      @mouseenter="navVisible = true"
    >
      <div v-if="navVisible && index > 0" class="viewer-nav-left" @click.stop="prev">‹</div>
      <div v-if="navVisible && index < files.length - 1" class="viewer-nav-right" @click.stop="next">›</div>

      <img
        v-if="currentFile"
        ref="imgEl"
        class="viewer-img"
        :src="'file://' + currentFile.filePath"
        :style="imgStyle"
        draggable="false"
        @load="onImgLoad"
      />
    </div>

    <div class="viewer-thumbs">
      <div
        v-for="slot in thumbSlots"
        :key="slot.index"
        class="thumb-item"
        :class="{ active: slot.active, empty: !slot.file }"
        :style="{ width: thumbSize(slot), height: thumbSize(slot), '--hover-scale': 68 / parseInt(thumbSize(slot)) }"
        @click="slot.file && (index = slot.index)"
      >
        <img
          v-if="slot.file?.thumbnail"
          :src="slot.file.thumbnail"
          :alt="slot.file.fileName || slot.file.relativePath"
          :title="slot.file.fileName || slot.file.relativePath"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ipcRenderer } from 'electron';
import { IPC } from '@common/ipcChannels';
import type { ViewerFile, ViewerPayload } from '@common/types';

/** 底部缩略图条在当前图两侧各展示的数量 */
const THUMBNAIL_RANGE = 30;

/** 缩略图边长（像素），选中项最大 */
const THUMBNAIL_SIZE = { active: 72, adjacent: 60, distant: 50 };

/** 最大放大倍率 */
const MAX_ZOOM = 5;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const files = ref<ViewerFile[]>([]);
const index = ref(0);
const navVisible = ref(false);
const dragging = ref(false);

/** 手动缩放倍率，0 表示按窗口自适应 */
const cssScale = ref(0);
const fitScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const displayZoom = ref('');

const dragStartX = ref(0);
const dragStartY = ref(0);
const imgEl = ref<HTMLImageElement | null>(null);
const viewerMain = ref<HTMLElement | null>(null);

// ------------------------------------------------------------
// 计算属性
// ------------------------------------------------------------

const currentFile = computed(() => files.value[index.value] ?? null);

/** 实际生效的缩放倍率 */
const realScale = computed(() => (cssScale.value <= 0 ? fitScale.value : cssScale.value));

const imgStyle = computed(() => ({
  width: 'auto',
  height: 'auto',
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${realScale.value})`,
  cursor: cssScale.value > 0 ? (dragging.value ? 'grabbing' : 'grab') : 'default',
  transition: dragging.value ? 'none' : 'transform 0.1s ease',
}));

/** 围绕当前图前后各取一段，形成可滚动的缩略图条 */
const thumbSlots = computed(() => {
  const slots: Array<{ index: number; file: ViewerFile | null; active: boolean }> = [];
  const total = files.value.length;

  for (let offset = -THUMBNAIL_RANGE; offset <= THUMBNAIL_RANGE; offset++) {
    const slotIndex = index.value + offset;
    slots.push({
      index: slotIndex,
      file: slotIndex >= 0 && slotIndex < total ? files.value[slotIndex] : null,
      active: slotIndex === index.value,
    });
  }
  return slots;
});

// ------------------------------------------------------------
// 缩放与拖拽
// ------------------------------------------------------------

/** 按窗口大小计算自适应倍率 */
function calcFit(): void {
  const image = imgEl.value;
  const container = viewerMain.value;
  if (!image || !container || !image.naturalWidth) {
    return;
  }

  fitScale.value = Math.min(
    (container.clientWidth * 0.95) / image.naturalWidth,
    (container.clientHeight * 0.95) / image.naturalHeight,
  );
  updateZoomLabel();
}

/** 刷新缩放百分比显示；处于自适应状态时按实际倍率显示 */
function updateZoomLabel(): void {
  displayZoom.value = `${Math.round(realScale.value * 100)}%`;
}

/** 重置为自适应并回到左上角原点 */
function resetView(): void {
  cssScale.value = 0;
  offsetX.value = 0;
  offsetY.value = 0;
  updateZoomLabel();
}

function onImgLoad(): void {
  calcFit();
  resetView();
}

function onResize(): void {
  calcFit();
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const current = realScale.value;
  const step = current * 0.15;
  let next = event.deltaY > 0 ? current - step : current + step;

  if (next <= fitScale.value) {
    resetView();
    return;
  }
  next = Math.min(MAX_ZOOM, next);

  // 以光标位置为锚点缩放
  const rect = viewerMain.value!.getBoundingClientRect();
  const cursorX = event.clientX - rect.left - rect.width / 2;
  const cursorY = event.clientY - rect.top - rect.height / 2;
  const ratio = next / current;

  offsetX.value = cursorX - ratio * (cursorX - offsetX.value);
  offsetY.value = cursorY - ratio * (cursorY - offsetY.value);
  cssScale.value = next;
  updateZoomLabel();
}

function onDblClick(): void {
  if (cssScale.value > 0) {
    resetView();
    return;
  }
  calcFit();
  cssScale.value = 1;
  offsetX.value = 0;
  offsetY.value = 0;
  updateZoomLabel();
}

// ------------------------------------------------------------
// 导航
// ------------------------------------------------------------

function prev(): void {
  if (index.value > 0) {
    index.value--;
  }
}

function next(): void {
  if (index.value < files.value.length - 1) {
    index.value++;
  }
}

function onClick(event: MouseEvent): void {
  if (cssScale.value > 0) {
    return;
  }

  const rect = viewerMain.value!.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  if (pointerX < rect.width * 0.3) {
    prev();
  } else if (pointerX > rect.width * 0.7) {
    next();
  }
}

function onMouseDown(event: MouseEvent): void {
  if (cssScale.value <= 0 || event.button !== 0) {
    return;
  }
  dragging.value = true;
  dragStartX.value = event.clientX - offsetX.value;
  dragStartY.value = event.clientY - offsetY.value;
}

function onMouseMove(event: MouseEvent): void {
  if (!dragging.value) {
    return;
  }
  offsetX.value = event.clientX - dragStartX.value;
  offsetY.value = event.clientY - dragStartY.value;
}

function onMouseUp(): void {
  dragging.value = false;
}

function onMouseLeave(): void {
  dragging.value = false;
  navVisible.value = false;
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft') {
    prev();
  }
  if (event.key === 'ArrowRight') {
    next();
  }
  if (event.key === 'Escape') {
    close();
  }
  if (event.key === '0') {
    resetView();
  }
}

function close(): void {
  window.close();
}

function formatSize(bytes: number | null): string {
  if (bytes === null) {
    return '-';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------
// 缩略图条
// ------------------------------------------------------------

/** 缩略图边长：当前项最大，相邻项次之 */
function thumbSize(slot: { index: number; active: boolean }): string {
  if (slot.active) {
    return `${THUMBNAIL_SIZE.active}px`;
  }
  if (Math.abs(slot.index - index.value) === 1) {
    return `${THUMBNAIL_SIZE.adjacent}px`;
  }
  return `${THUMBNAIL_SIZE.distant}px`;
}

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

watch(index, () => {
  cssScale.value = 0;
  offsetX.value = 0;
  offsetY.value = 0;
  updateZoomLabel();
});

async function init(): Promise<void> {
  const payload = (await ipcRenderer.invoke(IPC.VIEWER_GET_DATA)) as ViewerPayload | undefined;
  if (payload) {
    files.value = payload.files;
    index.value = payload.index;
  }
  window.addEventListener('resize', onResize);
}

onMounted(init);
onUnmounted(() => window.removeEventListener('resize', onResize));
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.viewer {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0d0d0d;
  color: #c8cad0;
  outline: none;
  user-select: none;
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #1a1a1a;
  flex-shrink: 0;
  font-size: 13px;
}

.viewer-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-zoom {
  color: #3871e1;
  font-weight: 600;
  min-width: 48px;
  text-align: right;
}

.viewer-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.viewer-nav-left,
.viewer-nav-right {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 56px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  user-select: none;
  z-index: 5;
  padding: 40px 12px;
  transition: color 0.15s;
}

.viewer-nav-left {
  left: 8px;
}

.viewer-nav-right {
  right: 8px;
}

.viewer-nav-left:hover,
.viewer-nav-right:hover {
  color: rgba(255, 255, 255, 0.9);
}

.viewer-img {
  will-change: transform;
  transform-origin: center center;
}

.viewer-thumbs {
  display: flex;
  gap: 6px;
  padding: 4px 100px 8px 100px;
  background: #1a1a1a;
  overflow: hidden;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  position: relative;
}

.viewer-thumbs::before,
.viewer-thumbs::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 100px;
  z-index: 2;
  pointer-events: none;
}

.viewer-thumbs::before {
  left: 0;
  background: linear-gradient(to right, #1a1a1a, rgba(26, 26, 26, 0));
}

.viewer-thumbs::after {
  right: 0;
  background: linear-gradient(to left, #1a1a1a, rgba(26, 26, 26, 0));
}

.thumb-item {
  flex-shrink: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.thumb-item.empty {
  visibility: hidden;
}

.thumb-item.active {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  border: 2px solid #3871e1;
  z-index: 4;
  position: relative;
}

.thumb-item:not(.active):hover {
  transform: scale(var(--hover-scale, 1.36));
  z-index: 3;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
}

.thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
