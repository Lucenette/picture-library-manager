<template>
  <div ref="hostEl" class="monaco-host"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ScriptCompileError } from '@common/types';
import { monaco } from './monaco-env';

const props = defineProps<{
  modelValue: string;
  /** 当前显示内容的编译错误；行列取不到时标记退回第一行 */
  error: ScriptCompileError | null;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'save'): void;
}>();

const hostEl = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

/** 正在把外部内容灌进编辑器：这一轮的内容变化不要再抛回去，否则会绕成环 */
let applying = false;

/** 把 props 的内容同步进编辑器（切脚本、放弃修改、保存回填都会走到这里） */
function syncValue(): void {
  if (!editor || editor.getValue() === props.modelValue) {
    return;
  }
  applying = true;
  editor.setValue(props.modelValue);
  applying = false;
}

/** 出错那一行整行染色的装饰集合：Monaco 的波浪线只有一两个字符宽，定位不如整行显眼 */
let errorLine: monaco.editor.IEditorDecorationsCollection | null = null;

/** 把编译错误画进代码：插入符位置一条标记 + 出错那一行整行淡红 */
function applyMarkers(): void {
  const model = editor?.getModel();
  if (!model) {
    return;
  }

  const error = props.error;
  if (error === null) {
    monaco.editor.setModelMarkers(model, 'plmanager', []);
    errorLine?.set([]);
    return;
  }

  const line = error.line ?? 1;
  const column = error.column ?? 1;
  monaco.editor.setModelMarkers(model, 'plmanager', [
    {
      severity: monaco.MarkerSeverity.Error,
      message: error.message,
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: column + 1,
    },
  ]);
  errorLine?.set([
    { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'plm-error-line' } },
  ]);
  editor?.revealLineInCenterIfOutsideViewport(line);
}

onMounted(() => {
  if (!hostEl.value) {
    return;
  }

  editor = monaco.editor.create(hostEl.value, {
    value: props.modelValue,
    language: 'javascript',
    theme: 'plmanager-dark',
    // 容器尺寸随窗口变，交给 Monaco 自己观察；省掉手写 ResizeObserver
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 4,
    insertSpaces: true,
    // 滚到底之后还能继续滚：最后一行可以升到视口顶部，改文件末尾时不用挤在屏幕最下边
    scrollBeyondLastLine: true,
    // 平滑滚动：滚轮推一下带一点缓动，不是一格一格跳
    smoothScrolling: true,
    // 问题面板在编辑器外面，浮动控件要允许溢出容器，否则提示会被裁掉
    fixedOverflowWidgets: true,
    // 120 列竖线：一行的长度是否超了，扫一眼就知道（写数字即可，颜色用 Monaco 的默认值）
    rulers: [120],
    // 粘性滚动：当前作用域（module.exports 里那个方法）滚出屏幕时，把它的首行钉在顶部
    stickyScroll: { enabled: true, maxLineCount: 3 },
  });

  editor.onDidChangeModelContent(() => {
    if (!applying && editor) {
      emit('update:modelValue', editor.getValue());
    }
  });

  // 焦点在编辑器里时 Monaco 先吃到按键，所以页面的 Ctrl+S 之外这里也注册一份
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'));

  errorLine = editor.createDecorationsCollection([]);
  applyMarkers();
});

watch(() => props.modelValue, syncValue);
watch(() => props.error, applyMarkers, { deep: true });

onBeforeUnmount(() => {
  editor?.dispose();
  editor = null;
});
</script>

<style scoped>
.monaco-host {
  height: 100%;
  min-height: 0;
}

/* 编译失败那一行的底色；装饰画在 Monaco 自己的 DOM 里，所以要 :deep */
.monaco-host :deep(.plm-error-line) {
  background: rgba(199, 84, 88, 0.16);
}
</style>
