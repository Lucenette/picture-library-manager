<template>
  <div class="script-editor">
    <div class="editor-head">
      <el-input v-model="name" class="name-input" placeholder="脚本名称" maxlength="80" />
      <div class="tags">
        <el-tag v-for="type in types" :key="type" size="small" type="warning">{{ typeLabel(type) }}</el-tag>
        <el-tag v-if="types.length === 0" size="small" type="info">未识别到可用方法</el-tag>
      </div>
      <!-- 没有保存按钮：现代编辑器都靠快捷键，这里把提示放在「未保存」标记上 -->
      <span v-if="dirty" class="dirty">未保存 · Ctrl+S</span>
      <div class="head-actions">
        <el-button :disabled="!dirty" @click="emit('discard')">放弃修改</el-button>
        <el-button v-if="builtin" @click="emit('reset')">恢复默认</el-button>
        <el-button v-else type="danger" @click="emit('remove')">删除</el-button>
      </div>
    </div>

    <div class="editor-body">
      <MonacoEditor v-model="code" :document-key="documentKey" :error="error" @save="emit('save')" />

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

    <p class="path">{{ filePath || '还没有落盘：按 Ctrl+S 保存后会生成文件' }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import type { ScriptCompileError, ScriptType } from '@common/types';
import MonacoEditor from './MonacoEditor.vue';
import { TYPE_LABELS } from './script-list';

const props = defineProps<{
  name: string;
  code: string;
  /** 当前脚本的 key：编辑器按它保留撤销历史与光标 */
  documentKey: string;
  types: ScriptType[];
  error: ScriptCompileError | null;
  /** Monaco 自带的实时语法诊断条数：它比主进程编译更早发现写坏了的草稿 */
  problemCount: number;
  dirty: boolean;
  builtin: boolean;
  filePath: string;
}>();

const emit = defineEmits<{
  (event: 'update:name', value: string): void;
  (event: 'update:code', value: string): void;
  (event: 'save'): void;
  (event: 'discard'): void;
  (event: 'remove'): void;
  (event: 'reset'): void;
}>();

// 名称与正文都是双向绑定的；名称一起进草稿，所以未保存状态把它们看作一件事
const name = computed({
  get: () => props.name,
  set: (value: string) => emit('update:name', value),
});

const code = computed({
  get: () => props.code,
  set: (value: string) => emit('update:code', value),
});

/** 有问题：主进程编译报错，或者 Monaco 实时诊断出语法问题 */
const hasProblem = computed(() => props.error !== null || props.problemCount > 0);

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

function typeLabel(type: ScriptType): string {
  return TYPE_LABELS[type];
}
</script>

<style scoped>
.script-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.editor-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--page-padding);
  padding-bottom: 10px;
}

.name-input {
  max-width: 260px;
}

.tags {
  display: flex;
  gap: 4px;
}

.dirty {
  color: var(--el-color-warning);
  font-size: 12px;
}

.head-actions {
  margin-left: auto;
}

.head-actions .el-button + .el-button {
  margin-left: 6px;
}

.path {
  padding: 6px 12px;
  color: var(--el-text-color-secondary);
  border-top: 1px solid var(--el-fill-color-light);
  font-size: 12px;
  word-break: break-all;
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
