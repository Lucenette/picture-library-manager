import type { SortScript } from '../registry';

/** 补零到 10 位就能让数字段按数值大小比较（`img2` < `img10`）；再长就保持原样，仍是前缀序 */
const DIGIT_WIDTH = 10;

/** 数字段：补零后原样比较 */
export const digitsScript: SortScript = {
  group: '2|',
  matches: (char) => char >= '0' && char <= '9',
  encode: (text) => (text.length < DIGIT_WIDTH ? text.padStart(DIGIT_WIDTH, '0') : text),
};
