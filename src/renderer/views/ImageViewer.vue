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
      @mouseleave="onMouseUp(); navVisible = false"
      @dblclick="onDblClick"
      @click="onClick"
      @mouseenter="navVisible = true"
    >
      <div v-if="navVisible && index > 0" class="viewer-nav-left" @click.stop="prev">‹</div>
      <div v-if="navVisible && index < files.length - 1" class="viewer-nav-right" @click.stop="next">›</div>
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
    <div class="viewer-thumbs">
      <div v-for="t in thumbSlots" :key="t.idx" class="thumb-item" :class="{ active: t.active, empty: !t.file }" :style="{ width: thumbSize(t), height: thumbSize(t), '--hover-scale': 68 / parseInt(thumbSize(t)) }" @click="t.file && (index = t.idx)">
        <img v-if="t.file?.thumbnail" :src="t.file.thumbnail" :alt="t.file.fileName || t.file.relativePath" :title="t.file.fileName || t.file.relativePath" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue';
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
const navVisible = ref(false);
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

function onResize(): void { calcFit(); }

const HALF = 30;

function thumbSize(t: { idx: number; active: boolean }): string {
  if (t.active) return '72px';
  if (Math.abs(t.idx - index.value) === 1) return '60px';
  return '50px';
}

const thumbSlots = computed(() => {
  const slots: { idx: number; file: ViewerFile | null; active: boolean }[] = [];
  const cur = index.value;
  const total = files.value.length;
  // 左30个 + 中间1个 + 右30个
  for (let i = cur - HALF; i <= cur + HALF; i++) {
    slots.push({
      idx: i,
      file: i >= 0 && i < total ? files.value[i] : null,
      active: i === cur,
    });
  }
  return slots;
});

watch(index, () => {
  cssScale.value = 0; offsetX.value = 0; offsetY.value = 0; displayZoom.value = scaleLabel();
});

async function init(): Promise<void> {
  const data = await ipcRenderer.invoke('viewer:getData');
  if (data) { files.value = data.files; index.value = data.index; }
  window.addEventListener('resize', onResize);
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
  if (e.key === 'F12') { ipcRenderer.invoke('viewer:devtools'); }
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
.viewer-nav-left, .viewer-nav-right {
  position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 56px; color: rgba(255,255,255,0.5); cursor: pointer;
  user-select: none; z-index: 5; padding: 40px 12px;
  transition: color 0.15s;
}
.viewer-nav-left { left: 8px; }
.viewer-nav-right { right: 8px; }
.viewer-nav-left:hover, .viewer-nav-right:hover { color: rgba(255,255,255,0.9); }
.viewer-img { will-change: transform; transform-origin: center center; }
.viewer-thumbs {
  display: flex; gap: 6px; padding: 4px 100px 8px 100px;
  background: #1a1a1a; overflow: hidden; flex-shrink: 0;
  align-items: center; justify-content: center;
  position: relative;
}
.viewer-thumbs::before,
.viewer-thumbs::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 100px; z-index: 2; pointer-events: none;
}
.viewer-thumbs::before { left: 0; background: linear-gradient(to right, #1a1a1a, rgba(26,26,26,0)); }
.viewer-thumbs::after { right: 0; background: linear-gradient(to left, #1a1a1a, rgba(26,26,26,0)); }
.thumb-item {
  flex-shrink: 0;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  border-radius: 4px; overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.thumb-item.empty { visibility: hidden; }
.thumb-item.active { box-shadow: 0 2px 12px rgba(0,0,0,0.4); border: 2px solid #3871e1; z-index: 4; position: relative; }
.thumb-item:not(.active):hover { transform: scale(var(--hover-scale, 1.36)); z-index: 3; box-shadow: 0 4px 20px rgba(0,0,0,0.7); }
.thumb-item img { width: 100%; height: 100%; object-fit: cover; }
</style>
