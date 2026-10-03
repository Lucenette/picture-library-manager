import type { SortScript } from '../registry';

/** 拉丁字母：原样小写（含带变音符号的字母，它们本来就该挨着排） */
export const latinScript: SortScript = {
  group: '4|',
  matches: (char) => /\p{Script=Latin}/u.test(char),
  encode: (text) => text.toLowerCase(),
};
