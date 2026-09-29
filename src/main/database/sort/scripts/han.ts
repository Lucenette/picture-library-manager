import { pinyin } from 'pinyin-pro';

import type { SortScript } from '../registry';

const HAN_PATTERN = /\p{Script=Han}/u;

/**
 * 读不出读音的汉字用它打头：ASCII 里 `~` 比所有字母都大，
 * 于是这些字落在汉字组的末尾，而不是被丢掉或被猜一个读音。
 */
const UNREADABLE_PREFIX = '~';

/** 汉字段：转全拼、小写、无声调，字间用一个空格分隔 */
export const hanScript: SortScript = {
  group: '3|',
  matches: (char) => HAN_PATTERN.test(char),
  encode: (text, profile) => {
    const options = { toneType: 'none', type: 'all', v: true } as const;
    const items =
      profile.han === 'surname'
        ? pinyin(text, { ...options, mode: 'surname', surname: 'all' })
        : pinyin(text, options);
    return items
      .map((item) => (item.pinyin.length > 0 ? item.pinyin.toLowerCase() : `${UNREADABLE_PREFIX}${item.origin}`))
      .join(' ');
  },
};
