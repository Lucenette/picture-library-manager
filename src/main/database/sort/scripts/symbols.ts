import type { SortScript } from '../registry';

/** 标点、符号与 emoji：原样小写，整段排在数字之前 */
export const symbolsScript: SortScript = {
  group: '1|',
  matches: (char) => /[\p{P}\p{S}]/u.test(char),
  encode: (text) => text.toLowerCase(),
};
