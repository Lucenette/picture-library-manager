<template>
  <div class="script-editor">
    <div class="editor-head">
      <el-input v-model="name" class="name-input" placeholder="脚本名称" maxlength="80" />
      <div class="tags">
        <el-tag v-for="type in types" :key="type" size="small" type="warning">{{ typeLabel(type) }}</el-tag>
        <el-tag v-if="types.length === 0" size="small" type="info">未识别到可用方法</el-tag>
      </div>
      <span v-if="dirty" class="dirty">未保存</span>
      <div class="head-actions">
        <el-button size="small" type="primary" @click="emit('save')">保存 Ctrl+S</el-button>
        <el-button size="small" :disabled="!dirty" @click="emit('discard')">放弃修改</el-button>
        <el-button v-if="builtin" size="small" @click="emit('reset')">恢复默认</el-button>
        <el-button v-else size="small" type="danger" @click="emit('remove')">删除</el-button>
      </div>
    </div>

    <p class="path">{{ filePath || '还没有落盘：按 Ctrl+S 保存后会生成文件' }}</p>

    <div class="editor-body">
      <MonacoEditor v-model="code" :error="error" @save="emit('save')" />
    </div>

    <div class="problems" :class="{ 'has-error': error !== null }">
      <template v-if="error">
        第 `{{ error.line ?? 1 }}` 行第 `{{ error.column ?? 1 }}` 列：`{{ error.message }}`
      </template>
      <template v-else>
        <span class="problem-ok">编译通过</span>
        <span class="problem-hint">`{{ dirty ? '当前显示的是未保存的草稿' : '当前显示的是磁盘上的版本' }}`</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScriptCompileError, ScriptType } from '@common/types';
import MonacoEditor from './MonacoEditor.vue';

/** 类型标签与脚本页一直用的那套中文名 */
const TYPE_LABELS: Record<ScriptType, string> = {
  'select-image': '图片',
  'identify-character': '角色',
  'identify-structure': '结构',
};

const props = defineProps<{
  name: string;
  code: string;
  types: ScriptType[];
  error: ScriptCompileError | null;
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
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
  font-size: 12px;
  word-break: break-all;
}

.editor-body {
  flex: 1;
  min-height: 0;
}

.problems {
  display: flex;
  align-items: baseline;
  gap: 8px;
  max-height: 30%;
  overflow-y: auto;
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color);
  background: #26282c;
  color: var(--el-text-color-regular);
  font-size: 12px;
  word-break: break-all;
}

.problems.has-error {
  color: var(--el-color-danger);
}

.problem-ok {
  color: var(--el-color-success);
}

.problem-hint {
  color: var(--el-text-color-secondary);
}
</style>
