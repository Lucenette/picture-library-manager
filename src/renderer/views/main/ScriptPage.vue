<template>
  <div class="script-page">
    <ScriptSideList
      :items="sideItems"
      :active-key="activeKey"
      @select="selectKey"
      @create="createScript"
      @import="importFiles"
    />

    <ScriptEditor
      v-if="activeKey !== ''"
      v-model:name="name"
      v-model:code="code"
      :document-key="activeKey"
      :types="types"
      :error="error"
      :problem-count="problemCount"
      :dirty="dirty"
      :builtin="builtin"
      :file-path="filePath"
      @save="save"
      @discard="discard"
      @problems="problemCount = $event"
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
  checkScript, deleteScript, deleteScriptDraft, getScriptUsage, importScripts, listScriptDrafts, listScripts,
  putScriptDraft, readScript, resetBuiltinScript, saveScript,
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
/** Monaco 报上来的实时诊断条数 */
const problemCount = ref(0);

/** 防抖用的定时器；切脚本、失焦、卸载时都要把它立即结算掉 */
let draftTimer: ReturnType<typeof setTimeout> | null = null;

// ------------------------------------------------------------
// 派生
// ------------------------------------------------------------

const dirty = computed(
  () => name.value !== baseline.value.name || code.value !== baseline.value.code,
);

/**
 * 左栏那一列：新建未保存的草稿排在最前（它们在库里还没有行），其余是库里的脚本。
 *
 * 状态照 IDEA 的 git 状态色给名字上色：新建未保存绿、改过未保存蓝、干净用默认色。
 */
const sideItems = computed(() => {
  const items: { key: string; name: string; state: 'new' | 'modified' | 'clean' }[] = [];

  for (const draft of Object.values(drafts.value)) {
    if (draft.key.startsWith('new-')) {
      items.push({ key: draft.key, name: draft.name, state: 'new' });
    }
  }

  for (const script of scripts.value) {
    const key = keyOfScript(script.id);
    // 活动项的「脏」以编辑框为准，其余项看有没有草稿
    const modified = key === activeKey.value ? dirty.value : drafts.value[key] !== undefined;
    items.push({
      key,
      name: drafts.value[key]?.name ?? script.name,
      state: modified ? 'modified' : 'clean',
    });
  }

  return items;
});

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

/** 上一次检查过的正文：内容没变就不必重查（载入脚本时也因此不会白跑一次） */
let lastCheckedCode: string | null = null;

/**
 * 正文或名称一改就排一次：先落草稿（脏了才写），再用这份最新代码查一遍状态。
 *
 * 判据是「与上次检查过的正文是否相同」，不是 `dirty`：把改动撤回到原样时也要重查，
 * 否则图标会停在上一次（可能是坏的）结果上。
 */
watch([name, code], () => {
  if (activeKey.value === '' || code.value === lastCheckedCode) {
    return;
  }
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
  }
  draftTimer = setTimeout(() => {
    void syncDraftAndCheck();
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

/**
 * 用当前这份代码查一遍状态：状态图标与类型标签据此更新，不必等到 Ctrl+S。
 *
 * 检查是**只读**的（主进程编译一遍、什么都不落）。它失败只是状态展示不出来，
 * 不弹窗打断，但也不装作没事——写进终端日志。
 */
async function checkCurrent(): Promise<void> {
  const key = activeKey.value;
  if (key === '') {
    return;
  }

  const checkedCode = code.value;
  try {
    const checked = await checkScript(checkedCode, filePath.value);
    if (activeKey.value !== key || code.value !== checkedCode) {
      return;
    }
    error.value = checked.compileError;
    types.value = checked.types;
    lastCheckedCode = checkedCode;
  } catch (caught) {
    console.error('[script] 检查脚本失败：', caught);
  }
}

/** 防抖到点：先落草稿（只有脏了才写），再用这份代码查一遍 */
async function syncDraftAndCheck(): Promise<void> {
  await flushDraft();
  await checkCurrent();
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

/**
 * 载入一个脚本。
 *
 * `activeKey` 一律**最后**赋值：编辑器的 key 与内容一起变，中间不会出现
 * 「key 已经是新脚本、内容还是旧脚本」的半截状态（那会让编辑器先建错 model 再被覆盖）。
 */
async function openKey(key: string): Promise<void> {
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
    // 新脚本的模板还没查过，留 null 让防抖那一次去查
    lastCheckedCode = null;
    activeKey.value = key;
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
    // readScript 已经在主进程编译过这一版，记下来省掉一次无谓的检查
    lastCheckedCode = code.value;
    activeKey.value = key;
  } catch (caught) {
    await alertDialog({ title: '打开脚本失败', message: (caught as Error).message, danger: true });
  }
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
  // 立刻落一份草稿并查一遍：保存之前，草稿是这份脚本唯一的家
  await syncDraftAndCheck();
}

async function importFiles(): Promise<void> {
  const paths = (await ipcRenderer.invoke(IPC.DIALOG_OPEN_SCRIPT)) as string[];
  if (paths.length === 0) {
    return;
  }

  const result = await importScripts(paths);
  await loadScripts();
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
    lastCheckedCode = code.value;
    await loadScripts();

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
/* 工具型页面：整页铺满，不填 --page-padding；留白由左右两栏各自的表头给 */
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
