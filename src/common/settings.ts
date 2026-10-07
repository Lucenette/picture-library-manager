import { DEFAULT_THEME, type ThemeName } from './theme';

/**
 * 设置：用户目录 `settings.yml` 的内容。
 *
 * 契约放在 common 是因为两个进程都要它——主进程读写与校验，渲染进程拿快照填表单；文件本身
 * 只有主进程读写（渲染进程不许碰 fs）。手改这个文件与在界面上改等价。
 */
export interface Settings {
  /** 界面主题：跟随系统 / 浅色 / 深色 */
  theme: ThemeName;
}

/** 每项的缺省值：文件不存在、键缺失、值非法都退回到这里，设置绝不挡住启动 */
export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
};

/** 主题可选项：值与文案放在一起，设置页与校验共用，免得两处各列一遍取值 */
export const THEME_OPTIONS: readonly { value: ThemeName; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

/** 取值是不是已知主题：渲染进程用它收窄单选组给回的值，主进程用它兜底设置文件里的坏值 */
export function isThemeName(value: unknown): value is ThemeName {
  return THEME_OPTIONS.some((option) => option.value === value);
}

/** 设置页要展示的只读运行信息：不是设置项、界面上改不了，但使用者要知道当前是什么 */
export interface SettingsInfo {
  /** 设置文件路径：手改它、备份它、报问题时给人都靠这一行 */
  filePath: string;
  /** 当前生效的日志级别 */
  logLevel: string;
  /** 日志级别的来源：环境变量名或默认值（级别在启动时就固化了，改它要重启） */
  logLevelSource: string;
}

/** `settings:get` 的返回：设置快照 + 只读运行信息 */
export interface SettingsSnapshot {
  settings: Settings;
  info: SettingsInfo;
}

/** 改设置的返回：`ok: false` 时界面保持原样，不做乐观更新 */
export interface SettingsUpdateResult {
  ok: boolean;
  /** 通过校验时是最新设置，被拒绝时是当前（未变的）设置 */
  settings: Settings;
  /** 被拒绝的原因（界面文案），成功时为空数组 */
  errors: string[];
}
