import { test, expect } from 'vitest';

import { IPC, LOAD_TASK } from '@common/ipcChannels';

test('IPC 通道值没有重复', () => {
  const values = Object.values(IPC);
  expect(new Set(values).size).toBe(values.length);
});

test('加载任务 id 没有重复', () => {
  const values = Object.values(LOAD_TASK);
  expect(new Set(values).size).toBe(values.length);
});
