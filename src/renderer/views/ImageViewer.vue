<template>
  <div class="viewer" @keydown="onKey" tabindex="0">
    <div class="viewer-toolbar">
      <span class="viewer-info">{{ index + 1 }} / {{ files.length }}</span>
      <span class="viewer-name">{{ currentFile?.relativePath }}</span>
      <span v-if="currentFile?.width" class="viewer-res">{{ currentFile?.width }} × {{ currentFile?.height }}</span>
      <span class="viewer-size">{{ formatSize(currentFile?.fileSize) }}</span>
      <span class="viewer-zoom">{{ displayZoom }}</span>
    </div>
    <div class="viewer-main" ref="viewerMain"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @dblclick="onDblClick"
      @click="onClick"
    >
      <img
        v-if="currentFile"
        :src="'file://' + currentFile.filePath"
        ref="imgEl"
        class="viewer-img"
        :style="imgStyle"
        draggable="false"
        @load="onImgLoad"
      />
    </div>
    <div class="viewer-thumbs" ref="thumbsRef" :style="{ paddingLeft: thumbPad + 'px' }">
      <div v-for="(f, i) in visibleThumbs" :key="f.idx" class="thumb-item" :class="{ active: f.idx === index }" @click="index = f.idx">
        <img v-if="f.file.thumbnail" :src="f.file.thumbnail" />
        <span v-else>🖼</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted, nextTick } from 'vue';
const { ipcRenderer } = require('electron');

interface ViewerFile {
  filePath: string;
  fileName?: string;
  relativePath?: string;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null;
}

const files = ref<ViewerFile[]>([]);
const index = ref(0);
const cssScale = ref(0);
const fitScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const dragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const displayZoom = ref('');
const imgEl = ref<HTMLImageElement | null>(null);
const viewerMain = ref<HTMLElement | null>(null);

const currentFile = computed(() => files.value[index.value] ?? null);

function realScale(): number { return cssScale.value <= 0 ? fitScale.value : cssScale.value; }

function scaleLabel(): string { return Math.round(realScale() * 100) + '%'; }

const imgStyle = computed(() => ({
  width: 'auto', height: 'auto',
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${realScale()})`,
  cursor: cssScale.value > 0 ? (dragging.value ? 'grabbing' : 'grab') : 'default',
  transition: dragging.value ? 'none' : 'transform 0.1s ease',
}));

function calcFit(): void {
  const img = imgEl.value; const ct = viewerMain.value;
  if (!img || !ct || !img.naturalWidth) return;
  fitScale.value = Math.min(ct.clientWidth * 0.95 / img.naturalWidth, ct.clientHeight * 0.95 / img.naturalHeight);
  if (cssScale.value <= 0) displayZoom.value = scaleLabel();
}

function onImgLoad(): void { calcFit(); cssScale.value = 0; offsetX.value = 0; offsetY.value = 0; displayZoom.value = scaleLabel(); }

function onResize(): void { calcFit(); calcThumbs(); }

const thumbsRef = ref<HTMLElement | null>(null);
const thumbCount = ref(10);
const thumbPad = ref(0);
const thumbW = 54; // 50px宽 + 4px gap

function calcThumbs(): void {
  const ct = thumbsRef.value;
  if (!ct) return;
  const count = Math.max(1, Math.floor((ct.clientWidth - 32) / thumbW));
  thumbCount.value = count;
  // 左填充让活动缩略图居中
  const half = Math.floor(count / 2);
  const start = Math.max(0, index.value - half);
  if (start === 0) {
    thumbPad.value = (half - index.value) * thumbW;
  } else if (index.value + half >= files.value.length) {
    const extra = index.value + half - files.value.length + 1;
    thumbPad.value = (half + extra) * thumbW;
  } else {
    thumbPad.value = 0;
  }
}

const visibleThumbs = computed(() => {
  const half = Math.floor(thumbCount.value / 2);
  const start = Math.max(0, index.value - half);
  const end = Math.min(files.value.length, start + thumbCount.value);
  const result: { idx: number; file: ViewerFile }[] = [];
  for (let i = start; i < end; i++) {
    if (files.value[i]) result.push({ idx: i, file: files.value[i] });
  }
  return result;
});

watch(index, () => {
  cssScale.value = 0; offsetX.value = 0; offsetY.value = 0; displayZoom.value = scaleLabel();
  calcThumbs();
});

async function init(): Promise<void> {
  const data = await ipcRenderer.invoke('viewer:getData');
  if (data) { files.value = data.files; index.value = data.index; }
  window.addEventListener('resize', onResize);
  await nextTick();
  calcThumbs();
}

function prev(): void { if (index.value > 0) index.value--; }
function next(): void { if (index.value < files.value.length - 1) index.value++; }

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const cur = realScale();
  const step = cur * 0.15;
  const delta = e.deltaY > 0 ? -step : step;
  let raw = cur + delta;
  if (raw <= fitScale.value) {
    cssScale.value = 0; offsetX.value = 0; offsetY.value = 0; displayZoom.value = scaleLabel(); return;
  }
  raw = Math.min(5, raw);
  const rect = viewerMain.value!.getBoundingClientRect();
  const mx = e.clientX - rect.left - rect.width / 2;
  const my = e.clientY - rect.top - rect.height / 2;
  const ratio = raw / cur;
  offsetX.value = mx - ratio * (mx - offsetX.value);
  offsetY.value = my - ratio * (my - offsetY.value);
  cssScale.value = raw;
  displayZoom.value = scaleLabel();
}

function onDblClick(): void {
  if (cssScale.value > 0) { cssScale.value = 0; offsetX.value = 0; offsetY.value = 0; }
  else { calcFit(); cssScale.value = 1; offsetX.value = 0; offsetY.value = 0; }
  displayZoom.value = scaleLabel();
}

function onClick(e: MouseEvent): void {
  if (cssScale.value > 0) return;
  const rect = viewerMain.value!.getBoundingClientRect();
  if (e.clientX - rect.left < rect.width * 0.3) prev();
  else if (e.clientX - rect.left > rect.width * 0.7) next();
}

function onMouseDown(e: MouseEvent): void {
  if (cssScale.value <= 0 || e.button !== 0) return;
  dragging.value = true;
  dragStartX.value = e.clientX - offsetX.value;
  dragStartY.value = e.clientY - offsetY.value;
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging.value) return;
  offsetX.value = e.clientX - dragStartX.value;
  offsetY.value = e.clientY - dragStartY.value;
}

function onMouseUp(): void { dragging.value = false; }

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
  if (e.key === 'Escape') close();
  if (e.key === '0') { cssScale.value = 0; offsetX.value = 0; offsetY.value = 0; displayZoom.value = scaleLabel(); }
}

function close(): void { window.close(); }

function formatSize(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

onMounted(init);
onUnmounted(() => window.removeEventListener('resize', onResize));
</script>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.viewer {
  height: 100vh; display: flex; flex-direction: column;
  background: #0d0d0d; color: #c8cad0; outline: none; user-select: none;
}
.viewer-toolbar {
  display: flex; align-items: center; gap: 16px;
  padding: 8px 16px; background: #1a1a1a; flex-shrink: 0; font-size: 13px;
}
.viewer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.viewer-zoom { color: #3871e1; font-weight: 600; min-width: 48px; text-align: right; }
.viewer-main {
  flex: 1; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.viewer-img { will-change: transform; transform-origin: center center; }
.viewer-thumbs {
  display: flex; gap: 4px; padding: 8px 16px;
  background: #1a1a1a; overflow-x: auto; flex-shrink: 0;
  height: 70px; align-items: center;
}
.thumb-item {
  width: 50px; height: 50px; flex-shrink: 0; border: 2px solid transparent;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  background: #222; border-radius: 4px; overflow: hidden;
}
.thumb-item.active { border-color: #3871e1; }
.thumb-item img { width: 100%; height: 100%; object-fit: cover; }
</style>
