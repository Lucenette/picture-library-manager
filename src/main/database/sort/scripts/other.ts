import type { SortScript } from '../registry';

/** 兜底：假名、谚文、希腊文、西里尔文以及一切没被前面认领的字符，整组排在拉丁之后 */
export const otherScript: SortScript = {
  group: '5|',
  matches: () => true,
  encode: (text) => text.toLowerCase(),
};
