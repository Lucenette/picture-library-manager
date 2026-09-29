import { DEFAULT_PROFILE, type SortProfile } from './profile';
import { SORT_SCRIPTS, type SortScript } from './registry';

/** 空名字的组前缀：`''` 与全空白归一到这里，排在所有有内容的键之前 */
const EMPTY_GROUP = '0|';

/** 段与段的连接符：正文里各段已经不含空白，所以空格可以安全当分隔符 */
const SEGMENT_SEPARATOR = ' ';

/** 找出管这个字符的模块；`other` 兜底，所以一定有结果 */
function scriptOf(char: string): SortScript {
  const found = SORT_SCRIPTS.find((script) => script.matches(char));
  if (!found) {
    throw new Error(`no sort script matches character: ${char}`);
  }
  return found;
}

/** 按字符类切段：连续的同类字符算一段，空白只当分隔符本身不参与比较 */
function splitSegments(text: string): { script: SortScript; text: string }[] {
  const segments: { script: SortScript; text: string }[] = [];
  let current: { script: SortScript; text: string } | null = null;
  for (const char of text) {
    if (char === SEGMENT_SEPARATOR) {
      current = null;
      continue;
    }
    const script = scriptOf(char);
    if (current && current.script === script) {
      current.text += char;
    } else {
      current = { script, text: char };
      segments.push(current);
    }
  }
  return segments;
}

/**
 * 算一个字符串的排序键：`<组前缀><正文>`。
 * 组的归属只看**首字符**，正文里各段各自转换后用一个空格连起来。
 * 键是派生数据、随时可整表重算，所以这里只保证确定性与不崩。
 */
export function sortKeyOf(text: string, profile: SortProfile = DEFAULT_PROFILE): string {
  const normalized = text.trim().replace(/\s+/gu, SEGMENT_SEPARATOR);
  if (normalized.length === 0) {
    return EMPTY_GROUP;
  }
  const head = scriptOf([...normalized][0]);
  const body = splitSegments(normalized)
    .map((segment) => segment.script.encode(segment.text, profile))
    .filter((part) => part.length > 0)
    .join(SEGMENT_SEPARATOR);
  return head.group + body;
}
