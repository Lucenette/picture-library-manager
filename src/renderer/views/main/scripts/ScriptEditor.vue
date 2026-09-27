<template>
  <div class="script-editor">
    <div class="editor-body">
      <MonacoEditor
        v-model="code"
        :document-key="documentKey"
        :error="error"
        :changes="changes"
        @save="emit('save')"
        @caret="caret = $event"
        @format="format = $event"
      />

      <!--
        编译状态悬浮在编辑区右上角（IDEA 那样）。
        有错时往下让一格：Monaco 自己的 marker 计数与跳转条占着最上沿那一条。
      -->
      <!--
        状态只用一个图标（IDEA 那个 widget 的做法）：没问题绿勾，有问题红叹号，细节走 tooltip。
        两种来源合并到这里：Monaco 自带的实时语法诊断（problemCount）与主进程的编译错误（error）。
      -->
      <el-tooltip :content="problemTitle" placement="left" :show-after="200">
        <div class="status" :class="{ 'has-problem': hasProblem }">
          <!-- 对勾自己画：el-icon 的 Check 是细线，14px 下被抗锯齿磨得更淡 -->
          <svg v-if="!hasProblem" class="status-check" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 8.5 L6.5 12 L13 4.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <el-icon v-else><WarningFilled /></el-icon>
        </div>
      </el-tooltip>
    </div>

    <!-- 状态栏：左边是检测到的导出类型，右边是光标/选区、行结束符与缩进、问题数 -->
    <footer class="status-bar">
      <span class="status-types">{{ typeText }}</span>
      <span v-if="caret" class="status-item">{{ caret }}</span>
      <span v-if="format" class="status-item">{{ format }}</span>
      <el-tooltip :content="problemTitle" placement="top" :show-after="200">
        <span class="status-problem" :class="{ 'has-problem': hasProblem }">{{ problemText }}</span>
      </el-tooltip>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import type { ScriptCompileError, ScriptType } from '@common/types';
import MonacoEditor from './MonacoEditor.vue';
import type { ScriptLineChange } from './diff';
import { TYPE_LABELS } from './script-list';

const props = defineProps<{
  code: string;
  /** 当前脚本的 key：编辑器按它保留撤销历史与光标 */
  documentKey: string;
  types: ScriptType[];
  error: ScriptCompileError | null;
  /** Monaco 自带的实时语法诊断条数：它比主进程编译更早发现写坏了的草稿 */
  problemCount: number;
  /** 与磁盘那一版的逐行差异：编辑器左边那些改动色条 */
  changes: ScriptLineChange[];
  dirty: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:code', value: string): void;
  (event: 'save'): void;
}>();

/** 状态栏右半边：光标/选区与行结束符/缩进，由 MonacoEditor 报上来 */
const caret = ref('');
const format = ref('');

const code = computed({
  get: () => props.code,
  set: (value: string) => emit('update:code', value),
});

/** 左下角：检测到的导出类型，不用标签样式，就是一行字 */
const typeText = computed(() => {
  if (props.types.length === 0) {
    return '未识别到可用方法';
  }
  return props.types.map((type) => TYPE_LABELS[type]).join(' · ');
});

/**
 * 问题数：Monaco 的实时语法诊断 + 主进程那一次编译。
 *
 * 同一个语法错误两边都会报，所以 Monaco 已经报了就不再累加——顺带让它在改好之后立刻归零，
 * 主进程那份要等下一次检查（草稿落盘后）才跟上。
 */
const problemTotal = computed(() => {
  if (props.problemCount > 0) {
    return props.problemCount;
  }
  return props.error === null ? 0 : 1;
});

/** 有问题：主进程编译报错，或者 Monaco 实时诊断出语法问题 */
const hasProblem = computed(() => problemTotal.value > 0);

const problemText = computed(() => (hasProblem.value ? `${problemTotal.value} 个问题` : '无问题'));

/** 图标本身不说话，细节放进 tooltip */
const problemTitle = computed(() => {
  const error = props.error;
  if (error !== null) {
    return `第 ${error.line ?? 1} 行第 ${error.column ?? 1} 列：${error.message}`;
  }
  if (props.problemCount > 0) {
    return `代码里有 ${props.problemCount} 处语法问题`;
  }
  return props.dirty ? '没有发现问题；有未保存的改动，按 Ctrl+S 保存' : '没有发现问题';
});

</script>

<style scoped>
.script-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding-top: var(--page-gap);
}

/* 状态栏：左边类型（占满剩余空间，把右边那几项顶到最右），右边光标/缩进/问题数 */
.status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  padding: 4px 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.status-types {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status-item {
  flex: none;
}

.status-problem {
  flex: none;
  color: #49794d;
  cursor: default;
}

.status-problem.has-problem {
  color: var(--el-color-danger);
}

.editor-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

/* 状态图标：像 IDEA 的 widget 那样贴住右上角、只占一行高度、没有边框 */
/* 右边留出滚动条的宽度，免得被那条竖条压住 */
.status {
  position: absolute;
  top: 0;
  right: 16px;
  z-index: 5;
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 6px;
  /* IDEA 那个绿：默认的 --el-color-success 在深色底上偏暗 */
  color: #49794d;
  font-size: 14px;
  cursor: default;
}

.status-check {
  width: 16px;
  height: 16px;
}

.status.has-problem {
  color: var(--el-color-danger);
}
</style>
