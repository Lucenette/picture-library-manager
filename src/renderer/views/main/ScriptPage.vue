<template>
  <div class="script-page">
    <ScriptSideList
      :items="sideItems"
      :active-key="activeKey"
      @select="selectKey"
      @create="createScript"
      @import="importFiles"
      @menu="onSideMenu"
    />

    <ScriptEditor
      v-if="activeKey !== ''"
      v-model:code="code"
      :document-key="activeKey"
      :types="types"
      :error="error"
      :problem-count="problemCount"
      :dirty="dirty"
      @save="save"
      @problems="problemCount = $event"
    />
    <div v-else class="empty">用左边的「新增脚本」或「加载文件」开始</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ipcRenderer } from 'electron';
import { ElMessage } from 'element-plus';
import { IPC } from '@common/ipcChannels';
import type {
  ProcessScript, PromptInitData, PromptResult, ScriptCompileError, ScriptDraft, ScriptMenuEntry, ScriptType,
} from '@common/types';
import DEFAULT_SCRIPT_SOURCE from '@static/default-script.js?raw';
import { useIpcListener } from '@/composables/useIpcListener';
import { alertDialog, confirmDialog } from '@/services/dialog-service';
import {
  checkScript, deleteScript, deleteScriptDraft, getScriptUsage, importScripts, listScriptDrafts, listScripts,
  openScriptMenu, putScriptDraft, readScript, renameScript, resetBuiltinScript, saveScript,
} from '@/services/script-service';
import ScriptEditor from './scripts/ScriptEditor.vue';
import ScriptSideList from './scripts/ScriptSideList.vue';
import type { SideAction, SideItem } from './scripts/script-list';

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
 * 左栏那一列：库里的脚本与新建未保存的草稿放在一起，一律按名称字典序排。
 *
 * 状态照 IDEA 的 git 状态色给名字上色：新建未保存绿、改过未保存蓝、干净用默认色。
 */
const sideItems = computed(() => {
  const items: SideItem[] = [];

  for (const draft of Object.values(drafts.value)) {
    if (draft.key.startsWith('new-')) {
      // 还没保存：库里没有它的行，类型与内置标记都无从谈起
      items.push({ key: draft.key, name: draft.name, state: 'new', types: [], builtin: false });
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
      types: script.types,
      builtin: script.builtin,
    });
  }

  // 中英混排：localeCompare('zh') 让中文按拼音落位；默认的码点顺序会把中文排到最前或最后
  items.sort((left, right) => left.name.localeCompare(right.name, 'zh'));
  return items;
});

// ------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------

onMounted(async () => {
  await loadScripts();
  await loadDrafts();
  // 打开左栏的第一项（排序之后的第一项，可能是一份还没保存的草稿）
  const first = sideItems.value[0];
  if (first !== undefined) {
    await openKey(first.key);
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
    const row = draft ?? { key, name: '未命名脚本', code: DEFAULT_SCRIPT_SOURCE, updatedAt: '' };
    name.value = row.name;
    code.value = row.code;
    // 新建脚本还没落盘：基线留空，于是它一出现就是「未保存」
    baseline.value = { name: '', code: '' };
    filePath.value = '';
    types.value = [];
    error.value = null;
    // 新脚本的正文还没查过，留 null 让防抖那一次去查
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
  // 起始正文就是随应用发布的内置脚本：两边共用同一份源码，省得维护两个默认模板
  code.value = DEFAULT_SCRIPT_SOURCE;
  baseline.value = { name: '', code: '' };
  filePath.value = '';
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

/**
 * 左栏右键：按这一项的状态决定菜单里有哪些项，再交给主进程弹原生菜单。
 *
 * 内置脚本不给「删除」，没有未保存改动不给「放弃修改」；重命名走角色那边同一个输入弹窗。
 */
async function onSideMenu(key: string): Promise<void> {
  const item = sideItems.value.find((entry) => entry.key === key);
  if (item === undefined) {
    return;
  }

  const entries: ScriptMenuEntry[] = [{ id: 'rename', label: '重命名' }];
  if (item.state !== 'clean') {
    entries.push({ id: 'discard', label: '放弃修改' });
  }
  entries.push(item.builtin ? { id: 'reset', label: '恢复默认' } : { id: 'remove', label: '删除' });

  const action = (await openScriptMenu(entries)) as SideAction | null;
  if (action !== null) {
    await onSideAction(action, key);
  }
}

/**
 * 执行菜单里选中的动作。
 *
 * 菜单作用于列表里的某一项，不一定是当前打开的那一项，所以先切过去再动手。
 */
async function onSideAction(action: SideAction, key: string): Promise<void> {
  if (key !== activeKey.value) {
    await selectKey(key);
  }

  if (action === 'rename') {
    promptRename(key);
    return;
  }
  if (action === 'discard') {
    await discard();
    return;
  }
  if (action === 'reset') {
    await resetBuiltin();
    return;
  }
  await removeScript();
}

/** 重命名：用角色重命名那套现成的输入弹窗，结果从 SCRIPT_RENAME_CONFIRMED 回到主窗口 */
function promptRename(key: string): void {
  const current = sideItems.value.find((entry) => entry.key === key)?.name ?? '';
  const payload: PromptInitData = {
    title: '重命名脚本',
    placeholder: '新名称',
    value: current,
    channel: IPC.SCRIPT_RENAME_CONFIRMED,
    scriptKey: key,
  };
  void ipcRenderer.invoke(IPC.PROMPT_OPEN, payload);
}

/**
 * 应用重命名结果。
 *
 * 已入库的改库里的名字，主进程顺带把草稿里的名字与图库里的名字副本一起改掉；
 * 新建未保存的只改草稿——列表立刻显示新名字，等 Ctrl+S 时才把名字写进库。
 */
async function applyRename(key: string, value: string): Promise<void> {
  const next = value.trim();
  if (next === '') {
    return;
  }

  const draft = drafts.value[key];
  try {
    if (key.startsWith('new-')) {
      const code = draft?.code ?? DEFAULT_SCRIPT_SOURCE;
      await putScriptDraft(key, { name: next, code });
      setDraft(key, { key, name: next, code, updatedAt: new Date().toISOString() });
    } else {
      await renameScript(Number(key.slice('script-'.length)), next);
      if (draft !== undefined) {
        setDraft(key, { ...draft, name: next });
      }
      await loadScripts();
    }

    if (key === activeKey.value) {
      name.value = next;
      if (!key.startsWith('new-')) {
        // 名字已经进库，不该因此变成「未保存」
        baseline.value = { ...baseline.value, name: next };
      }
    }
  } catch (error) {
    await alertDialog({ title: '重命名失败', message: (error as Error).message, danger: true });
  }
}

useIpcListener(IPC.SCRIPT_RENAME_CONFIRMED, async (result: PromptResult) => {
  if (!result.value || !result.scriptKey) {
    return;
  }
  await applyRename(result.scriptKey, result.value);
});

/**
 * 删除当前脚本。
 *
 * 新建未保存的脚本只活在草稿文件里（库里没有它的行），删它就是删那份草稿——只清内存里的副本
 * 会让它在下次打开脚本页时原样回来。
 */
async function removeScript(): Promise<void> {
  // 先把排着队的落草稿取消掉：删除之后再写一次，删掉的东西就回来了
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }

  if (activeKey.value.startsWith('new-')) {
    await removeUnsavedScript();
    return;
  }

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

/** 删掉一个还没保存过的新脚本：确认后只删草稿，再选中列表里的下一项 */
async function removeUnsavedScript(): Promise<void> {
  const key = activeKey.value;
  const confirmed = await confirmDialog({
    title: '删除脚本',
    message: `确定删除「${name.value}」？它还没保存过，删掉就找不回来了。`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  await deleteScriptDraft(key);
  clearDraft(key);
  activeKey.value = '';
  const next = sideItems.value[0];
  if (next !== undefined) {
    await openKey(next.key);
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
/* 工具型页面：整页铺满，不填 --page-padding；留白由左栏表头与编辑区自己给 */
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
