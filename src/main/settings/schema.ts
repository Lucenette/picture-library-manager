import { dump, loadAll } from 'js-yaml';

import { DEFAULT_SETTINGS, isThemeName, type Settings } from '@common/settings';

/**
 * 设置文件的解析与生成：不碰 fs、不碰 electron，纯文本进出。
 *
 * 分成一层是因为它是最值得写用例的部分（坏文件、缺键、坏值、未知键），而它一旦 import 了
 * `@/log` 或 `@/paths` 就会把 electron 拖进来，用例就跑不起来了。记日志由调用方（store）负责。
 */

/** 解析结果：能用的设置 + 文件里我们不认识的键 + 坏值说明 */
export interface ParsedSettings {
  settings: Settings;
  /** 未知键：别的版本写的、或手写的备注，写回时原样带回去，不抹掉 */
  unknown: Record<string, unknown>;
  /** 坏值与坏文件的原因（英文，直接进日志） */
  errors: string[];
}

/** 认得的键；写回时排在最前面 */
const KNOWN_KEYS = ['theme'] as const;

/**
 * 解析设置文件。
 *
 * 一律不抛错：文件坏掉、键缺失、值非法都不影响启动，能用的用上、坏的退回默认值并把原因交出去。
 * 空文件与只写了注释的文件都是合法状态（还没改过任何设置就长这样），不算错误——所以用 `loadAll`
 * 而不是 `load`：后者对空输入直接抛错，那会让人以为设置文件坏了。
 */
export function parseSettings(text: string): ParsedSettings {
  let documents: unknown[];
  try {
    documents = loadAll(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { settings: { ...DEFAULT_SETTINGS }, unknown: {}, errors: [`settings file is not valid YAML: ${reason}`] };
  }

  if (documents.length === 0) {
    return { settings: { ...DEFAULT_SETTINGS }, unknown: {}, errors: [] };
  }

  const errors: string[] = [];
  if (documents.length > 1) {
    // 只读第一个文档，但要说出来：后面那些不会被写回，静默丢掉比报一条更坏
    errors.push(`settings file has ${documents.length} documents, using the first one`);
  }

  const raw = documents[0];
  if (raw === undefined || raw === null) {
    return { settings: { ...DEFAULT_SETTINGS }, unknown: {}, errors };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('settings file must be a mapping');
    return { settings: { ...DEFAULT_SETTINGS }, unknown: {}, errors };
  }

  const source = raw as Record<string, unknown>;
  const settings: Settings = { ...DEFAULT_SETTINGS };

  if ('theme' in source) {
    if (isThemeName(source.theme)) {
      settings.theme = source.theme;
    } else {
      errors.push(`invalid theme, falling back to ${DEFAULT_SETTINGS.theme}: ${String(source.theme)}`);
    }
  }

  const unknown = { ...source };
  for (const key of KNOWN_KEYS) {
    delete unknown[key];
  }
  return { settings, unknown, errors };
}

/**
 * 把设置与未知键写成 YAML 文本。
 *
 * 已知键在前、未知键在后；**注释与原来的排版不会保留**（js-yaml 不做文档级往返），手改过的人
 * 会在第一次在界面上改动后看到重排——这条写在 docs/roadmap/settings-page.md 的已知代价里。
 */
export function serializeSettings(settings: Settings, unknown: Record<string, unknown>): string {
  // lineWidth 关掉折行：设置项以后会长到一行放不下，折了反而难读
  return dump({ ...settings, ...unknown }, { indent: 2, lineWidth: -1 });
}

/**
 * 校验渲染进程提交的改动：只认已知键，值非法就整条拒绝。
 *
 * 界面上的取值由单选组限定，这里管的是「通道被别的东西调用」——所以错误文案是给界面看的
 * （输入校验类文案保持中文），不进日志。
 */
export function sanitizePatch(raw: unknown): { patch: Partial<Settings>; errors: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { patch: {}, errors: ['设置内容格式不对'] };
  }

  const patch: Partial<Settings> = {};
  const errors: string[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'theme') {
      if (isThemeName(value)) {
        patch.theme = value;
      } else {
        errors.push(`主题取值不合法：${String(value)}`);
      }
      continue;
    }
    errors.push(`没有这个设置项：${key}`);
  }
  return { patch, errors };
}
