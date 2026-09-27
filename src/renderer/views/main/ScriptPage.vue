<template>
  <div class="script-page">
    <ScriptSideList
      :items="sideItems"
      :active-key="activeKey"
      @select="selectKey"
      @create="createScript"
      @import="importFiles"
      @refresh="refreshAll"
    />

    <ScriptEditor
      v-if="activeKey !== ''"
      v-model:name="name"
      v-model:code="code"
      :types="types"
      :error="error"
      :dirty="dirty"
      :builtin="builtin"
      :file-path="filePath"
      @save="save"
      @discard="discard"
      @remove="removeScript"
      @reset="resetBuiltin"
    />
    <div v-else class="empty">用左边的「新增脚本」或「加载文件」开始</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ipcRenderer } from 'electron';
import { ElMessage } from 'element-plus';
import { IPC } from '@common/ipcChannels';
import type { ProcessScript, ScriptCompileError, ScriptDraft, ScriptType } from '@common/types';
import { alertDialog, confirmDialog } from '@/services/dialog-service';
import {
  deleteScript, deleteScriptDraft, getScriptUsage, importScripts, listScriptDrafts, listScripts,
  putScriptDraft, readScript, refreshAllScripts, resetBuiltinScript, saveScript,
} from '@/services/script-service';
import ScriptEditor from './scripts/ScriptEditor.vue';
import ScriptSideList from './scripts/ScriptSideList.vue';

/** 新增脚本的起始正文：给个最小骨架，省得对着空文件发呆 */
const NEW_SCRIPT_TEMPLATE = `// 处理脚本：CommonJS，module.exports 导出要用的方法
//   identify-structure({ rootPath, tree }) → [{ name, groups }]
//   select-image({ characterName, groupDirPath, files }) → 某个文件的 uuid
module.exports = {
  'select-image': () => {
    throw new Error('还没有实现选图逻辑');
  },
};
`;

/** 草稿防抖：1 秒。VS Code 的 hot exit 也是这个量级（默认 1000ms，开 autosave 时 2000ms） */
const DRAFT_DEBOUNCE_MS = 1000;

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

const scripts = ref<ProcessScript[]>([]);
/** 全部未保存的草稿，key 是 `script-<id>` 或 `new-<uuid>` */
const drafts = ref<Record<string, ScriptDraft>>({});
/** 编译不过（或文件缺失）的脚本 key：左栏据此标红点 */
const brokenKeys = ref<Record<string, true>>({});

const activeKey = ref('');
const name = ref('');
const code = ref('');
const types = ref<ScriptType[]>([]);
const error = ref<ScriptCompileError | null>(null);
const filePath = ref('');
const builtin = ref(false);
/** 磁盘上的那一份：用来判断「改了没有」 */
const baseline = ref({ name: '', code: '' });
const saving = ref(false);

/** 防抖用的定时器；切脚本、失焦、卸载时都要把它立即结算掉 */
let draftTimer: ReturnType<typeof setTimeout> | null = null;

// ------------------------------------------------------------
// 派生
// ------------------------------------------------------------

const dirty = computed(
  () => name.value !== baseline.value.name || code.value !== baseline.value.code,
);

const sideItems = computed(() =>
  scripts.value.map((script) => {
    const key = keyOfScript(script.id);
    return {
      key,
      name: drafts.value[key]?.name ?? script.name,
      dirty: key === activeKey.value ? dirty.value : drafts.value[key] !== undefined,
      broken: brokenKeys.value[key] === true,
    };
  }),
);

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

onMounted(async () => {
  await loadScripts();
  await loadDrafts();
  const first = scripts.value[0];
  if (first) {
    await openKey(keyOfScript(first.id));
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('blur', onBlur);
  void flushDraft();
});

window.addEventListener('keydown', onKeydown);
window.addEventListener('blur', onBlur);

/** 页面级 Ctrl/Cmd+S：焦点在编辑器里时由 Monaco 的命令兜底 */
function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
  }
}

function onBlur(): void {
  void flushDraft();
}

/** 名称与正文改了才排草稿；载入脚本时它们与基线一致，不会误写 */
watch([name, code], () => {
  if (activeKey.value === '' || !dirty.value) {
    return;
  }
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
  }
  draftTimer = setTimeout(() => {
    void flushDraft();
  }, DRAFT_DEBOUNCE_MS);
});

// ------------------------------------------------------------
// 草稿
// ------------------------------------------------------------

function setDraft(key: string, draft: ScriptDraft): void {
  drafts.value = { ...drafts.value, [key]: draft };
}

function clearDraft(key: string): void {
  const next = { ...drafts.value };
  delete next[key];
  drafts.value = next;
}

/** 把当前编辑内容写进草稿；失败要让人看见，不能静默丢 */
async function flushDraft(): Promise<void> {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  const key = activeKey.value;
  if (key === '' || !dirty.value) {
    return;
  }

  try {
    await putScriptDraft(key, { name: name.value, code: code.value });
    setDraft(key, { key, name: name.value, code: code.value, updatedAt: new Date().toISOString() });
  } catch (caught) {
    await alertDialog({ title: '草稿保存失败', message: (caught as Error).message, danger: true });
  }
}

async function loadDrafts(): Promise<void> {
  const list = await listScriptDrafts();
  const next: Record<string, ScriptDraft> = {};
  for (const draft of list) {
    next[draft.key] = draft;
  }
  drafts.value = next;
}

// ------------------------------------------------------------
// 载入
// ------------------------------------------------------------

function keyOfScript(id: number): string {
  return `script-${id}`;
}

async function loadScripts(): Promise<void> {
  scripts.value = await listScripts();
}

/** 切换脚本：先把上一份草稿结算掉，再载入新的 */
async function selectKey(key: string): Promise<void> {
  if (key === activeKey.value) {
    return;
  }
  await flushDraft();
  await openKey(key);
}

async function openKey(key: string): Promise<void> {
  activeKey.value = key;
  const draft = drafts.value[key];

  if (key.startsWith('new-')) {
    const row = draft ?? { key, name: '未命名脚本', code: NEW_SCRIPT_TEMPLATE, updatedAt: '' };
    name.value = row.name;
    code.value = row.code;
    // 新建脚本还没落盘：基线留空，于是它一出现就是「未保存」
    baseline.value = { name: '', code: '' };
    filePath.value = '';
    builtin.value = false;
    types.value = [];
    error.value = null;
    return;
  }

  const id = Number(key.slice('script-'.length));
  const row = scripts.value.find((script) => script.id === id);
  try {
    const result = await readScript(id);
    name.value = draft?.name ?? row?.name ?? '';
    code.value = draft?.code ?? result.code;
    filePath.value = row?.filePath ?? '';
    builtin.value = row?.builtin ?? false;
    types.value = result.types;
    error.value = result.compileError;
    baseline.value = { name: row?.name ?? '', code: result.code };
    markBroken(key, result.compileError !== null);
  } catch (caught) {
    await alertDialog({ title: '打开脚本失败', message: (caught as Error).message, danger: true });
  }
}

function markBroken(key: string, broken: boolean): void {
  const next = { ...brokenKeys.value };
  if (broken) {
    next[key] = true;
  } else {
    delete next[key];
  }
  brokenKeys.value = next;
}

// ------------------------------------------------------------
// 操作
// ------------------------------------------------------------

/** 新增脚本：只活在内存与草稿里，Ctrl+S 之后才落盘生成文件 */
async function createScript(): Promise<void> {
  await flushDraft();
  // 不用 crypto.randomUUID：这里只要一个不重复的临时 key
  const key = `new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  name.value = '未命名脚本';
  code.value = NEW_SCRIPT_TEMPLATE;
  baseline.value = { name: '', code: '' };
  filePath.value = '';
  builtin.value = false;
  types.value = [];
  error.value = null;
  activeKey.value = key;
  // 立刻落一份草稿：保存之前，草稿是这份脚本唯一的家
  await flushDraft();
}

async function importFiles(): Promise<void> {
  const paths = (await ipcRenderer.invoke(IPC.DIALOG_OPEN_SCRIPT)) as string[];
  if (paths.length === 0) {
    return;
  }

  const result = await importScripts(paths);
  await loadScripts();
  for (const script of result.imported) {
    markBroken(keyOfScript(script.id), false);
  }
  if (result.failed.length > 0) {
    await alertDialog({
      title: '部分脚本导入失败',
      message: result.failed.map((item) => `${item.path}：${item.message}`).join('\n'),
      danger: true,
    });
  }
  if (result.imported.length > 0) {
    ElMessage.success(`已导入 ${result.imported.length} 个脚本`);
    await openKey(keyOfScript(result.imported[0].id));
  }
}

async function refreshAll(): Promise<void> {
  const results = await refreshAllScripts();
  await loadScripts();
  const broken: string[] = [];
  for (const item of results) {
    const key = keyOfScript(item.script.id);
    markBroken(key, item.compileError !== null);
    if (item.compileError !== null) {
      broken.push(`${item.script.name}：${item.compileError.message}`);
    }
  }
  // 刷新看的是磁盘上的版本，**不能拿它覆盖活动脚本的显示状态**：
  // 有草稿时编辑器显示的是草稿，那个状态只能由草稿重新编译一次得出
  if (drafts.value[activeKey.value] !== undefined) {
    await openKey(activeKey.value);
  } else if (activeKey.value.startsWith('script-')) {
    const current = results.find((item) => keyOfScript(item.script.id) === activeKey.value);
    if (current) {
      error.value = current.compileError;
      types.value = current.script.types;
    }
  }
  if (broken.length > 0) {
    await alertDialog({ title: '有脚本没通过编译', message: broken.join('\n'), danger: true });
  } else {
    ElMessage.success('全部脚本都通过编译');
  }
}

async function save(): Promise<void> {
  if (saving.value || activeKey.value === '') {
    return;
  }
  saving.value = true;
  try {
    const id = activeKey.value.startsWith('script-') ? Number(activeKey.value.slice('script-'.length)) : null;
    const result = await saveScript({
      id,
      name: name.value,
      code: code.value,
      draftKey: activeKey.value,
    });

    clearDraft(activeKey.value);
    const key = keyOfScript(result.script.id);
    if (key !== activeKey.value) {
      clearDraft(activeKey.value);
      activeKey.value = key;
    }
    name.value = result.script.name;
    baseline.value = { name: result.script.name, code: code.value };
    filePath.value = result.script.filePath;
    builtin.value = result.script.builtin;
    types.value = result.script.types;
    error.value = result.compileError;
    markBroken(key, result.compileError !== null);
    await loadScripts();

    if (result.compileError === null) {
      ElMessage.success('已保存');
    } else {
      ElMessage.warning('已保存，但编译没过：看下面的问题');
    }
  } catch (caught) {
    await alertDialog({ title: '保存失败', message: (caught as Error).message, danger: true });
  } finally {
    saving.value = false;
  }
}

/** 放弃修改：删掉草稿，重新从磁盘读一遍 */
async function discard(): Promise<void> {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  await deleteScriptDraft(activeKey.value);
  clearDraft(activeKey.value);
  await openKey(activeKey.value);
}

async function removeScript(): Promise<void> {
  const id = Number(activeKey.value.slice('script-'.length));
  const usage = await getScriptUsage(id);
  const confirmed = await confirmDialog({
    title: '删除脚本',
    message:
      usage > 0
        ? `确定删除脚本「${name.value}」？图库里有 ${usage} 条记录来自它：那列会保留脚本名（历史上是它选的），脚本本身会删掉。`
        : `确定删除脚本「${name.value}」？`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  await deleteScript(id);
  clearDraft(activeKey.value);
  await loadScripts();
  const next = scripts.value[0];
  activeKey.value = '';
  if (next) {
    await openKey(keyOfScript(next.id));
  }
}

async function resetBuiltin(): Promise<void> {
  const id = Number(activeKey.value.slice('script-'.length));
  const confirmed = await confirmDialog({
    title: '恢复默认',
    message: `确定把内置脚本「${name.value}」的内容恢复成随应用发布的版本？当前改动会丢。`,
    confirmText: '恢复',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  const result = await resetBuiltinScript(id);
  clearDraft(activeKey.value);
  name.value = result.script.name;
  code.value = '';
  baseline.value = { name: result.script.name, code: '' };
  await openKey(activeKey.value);
  ElMessage.success('已恢复默认');
}
</script>

<style scoped>
.script-page {
  display: flex;
  height: 100%;
  min-height: 0;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
