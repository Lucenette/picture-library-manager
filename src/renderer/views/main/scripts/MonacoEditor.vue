<template>
  <div ref="hostEl" class="monaco-host"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ScriptCompileError } from '@common/types';
import { monaco } from './monaco-env';

const props = defineProps<{
  modelValue: string;
  /** 当前文档的 key（`script-<id>` / `new-<uuid>`）：一份文档一个 model，撤销历史与光标按它保留 */
  documentKey: string;
  /** 当前显示内容的编译错误；行列取不到时标记退回第一行 */
  error: ScriptCompileError | null;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'save'): void;
  /** Monaco 自己的诊断条数变化（不算我们设的编译标记）：状态图标与状态栏据此变色 */
  (event: 'problems', count: number): void;
  /** 状态栏里的光标位置；有选区时是选区的行数与字符数 */
  (event: 'caret', text: string): void;
  /** 状态栏里的行结束符与缩进 */
  (event: 'format', text: string): void;
}>();

const hostEl = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

/** 一份文档一个 model：换脚本只换 model，撤销栈按 model 的 URI 记账，所以切走再切回来还能撤销 */
const models = new Map<string, monaco.editor.ITextModel>();
/** 每份文档的光标与滚动位置，跟着 model 一起保留 */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

/** 出错那一行整行染色的装饰集合 */
let errorLine: monaco.editor.IEditorDecorationsCollection | null = null;
/** marker 变化的订阅：Monaco 的语法诊断是异步算出来的，得靠它上报 */
let markerSubscription: monaco.IDisposable | null = null;
/** 正在把外部内容灌进编辑器：这一轮的变化不要再抛回去，否则会绕成环 */
let applying = false;

/** 取当前文档的 model，没有就建一个 */
function modelFor(key: string): monaco.editor.ITextModel {
  const existing = models.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = monaco.editor.createModel(props.modelValue, 'javascript');
  models.set(key, created);
  return created;
}

/** 找出某个 model 挂在哪个 key 上 */
function keyOfModel(model: monaco.editor.ITextModel): string | undefined {
  for (const [key, item] of models) {
    if (item === model) {
      return key;
    }
  }
  return undefined;
}

/** 换文档：存下旧的位置、换上（或新建）对应 model、恢复位置 */
function switchDocument(): void {
  const current = editor;
  if (current === null) {
    return;
  }

  const previous = current.getModel();
  const previousKey = previous === null ? undefined : keyOfModel(previous);
  if (previous !== null && previousKey !== undefined) {
    viewStates.set(previousKey, current.saveViewState());
  }

  // 新建脚本保存后 key 会从 new-x 变成 script-7，而内容一个字没动：
  // 这种时候沿用同一个 model，撤销历史不至于在"第一次保存"时断掉
  if (!models.has(props.documentKey) && previous !== null && previous.getValue() === props.modelValue) {
    if (previousKey !== undefined) {
      models.delete(previousKey);
    }
    models.set(props.documentKey, previous);
  }

  const model = modelFor(props.documentKey);
  if (current.getModel() !== model) {
    current.setModel(model);
    current.restoreViewState(viewStates.get(props.documentKey) ?? null);
  }
  applyMarkers();
  reportProblems();
  reportCaret();
  reportFormat();
}

/**
 * 同一份文档里内容被换掉（放弃修改、恢复默认）。
 *
 * 这里是**整块替换**，Monaco 会连编辑历史一起清掉（`_setValueFromTextBuffer` 里的
 * commandManager.clear()）——正是这两个动作该有的语义。
 */
function syncValue(): void {
  const model = editor?.getModel();
  if (!model || model.getValue() === props.modelValue) {
    return;
  }
  applying = true;
  model.setValue(props.modelValue);
  applying = false;
}

/**
 * 把当前模型上的诊断条数报给外面。
 *
 * 只数 Monaco 自己的诊断（`owner !== 'plmanager'`）：我们自己设的编译标记是另一条信息，
 * 把它也算进来会让「改好了」之后计数迟迟不归零。
 */
function reportProblems(): void {
  const model = editor?.getModel();
  if (!model) {
    emit('problems', 0);
    return;
  }
  const own = monaco.editor.getModelMarkers({ resource: model.uri }).filter((marker) => marker.owner !== 'plmanager');
  emit('problems', own.length);
}

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
  // 不把视口弹到出错行：很多人是边写边存的，写着写着被抢走视线很烦；
  // 那一行有整行染色与概览标尺，找得到
}

/**
 * 报出光标位置：有选区时报选区的行数与字符数，没有就报行列。
 *
 * 文案在这里定，因为模型与光标都在这边；外面只把它摆进状态栏。
 */
function reportCaret(): void {
  const current = editor;
  const model = current?.getModel();
  const position = current?.getPosition();
  if (!current || !model || !position) {
    emit('caret', '');
    return;
  }

  const selection = current.getSelection();
  if (selection && !selection.isEmpty()) {
    const chars = model.getValueInRange(selection).length;
    const lines = selection.endLineNumber - selection.startLineNumber + 1;
    emit('caret', lines > 1 ? `已选 ${lines} 行 ${chars} 字符` : `已选 ${chars} 字符`);
    return;
  }
  emit('caret', `行 ${position.lineNumber}，列 ${position.column}`);
}

/**
 * 报出行的结束符与缩进。
 *
 * 缩进取模型解析后的值：`detectIndentation` 默认开着，所以它反映的是这份文件的实际缩进
 * （内置脚本是 2 个空格，编辑器默认值是 4），而不是我们创建编辑器时给的那个默认数。
 */
function reportFormat(): void {
  const model = editor?.getModel();
  if (!model) {
    emit('format', '');
    return;
  }
  const options = model.getOptions();
  const eol = model.getEOL() === '\r\n' ? 'CRLF' : 'LF';
  const indent = options.insertSpaces ? `${options.tabSize} 个空格` : `Tab ${options.tabSize}`;
  emit('format', `${eol} · ${indent}`);
}

onMounted(() => {
  if (!hostEl.value) {
    return;
  }

  editor = monaco.editor.create(hostEl.value, {
    model: modelFor(props.documentKey),
    theme: 'plmanager-dark',
    // 容器尺寸随窗口变，交给 Monaco 自己观察；省掉手写 ResizeObserver
    automaticLayout: true,
    minimap: { enabled: false },
    // 与应用的基础字号一致（--el-font-size-base 也是 14px），Monaco 默认的 12 在深色底上偏小
    fontSize: 14,
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
    // 缩进是探测出来的：改完正文要重报一次
    reportFormat();
  });

  // 焦点在编辑器里时 Monaco 先吃到按键，所以页面的 Ctrl+S 之外这里也注册一份
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit('save'));

  errorLine = editor.createDecorationsCollection([]);
  applyMarkers();
  // 我们设的编译标记与 Monaco 的语法诊断都会触发它，状态图标因此能实时反映问题
  markerSubscription = monaco.editor.onDidChangeMarkers(() => reportProblems());
  reportProblems();

  // 状态栏那两栏：光标一动就报，行结束符/缩进随模型走
  editor.onDidChangeCursorPosition(() => reportCaret());
  editor.onDidChangeCursorSelection(() => reportCaret());
  reportCaret();
  reportFormat();
});

watch(() => props.documentKey, switchDocument);
watch(() => props.modelValue, syncValue);
watch(() => props.error, applyMarkers, { deep: true });

onBeforeUnmount(() => {
  markerSubscription?.dispose();
  markerSubscription = null;
  editor?.dispose();
  editor = null;
  for (const model of models.values()) {
    model.dispose();
  }
  models.clear();
  viewStates.clear();
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
