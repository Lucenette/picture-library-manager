import { test, expect } from 'vitest';

import { TaskCancelledError, TaskControl } from '@/task/task-control';

test('暂停后 checkpoint 挂起，resume 后继续', async () => {
  const control = new TaskControl();
  control.pause();
  expect(control.isPaused).toBe(true);

  let resumed = false;
  const pending = control.checkpoint().then(() => {
    resumed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(resumed).toBe(false);

  control.resume();
  await pending;
  expect(resumed).toBe(true);
  expect(control.isPaused).toBe(false);
});

test('abort 后 checkpoint 抛 TaskCancelledError', async () => {
  const control = new TaskControl();
  control.abort();
  await expect(control.checkpoint()).rejects.toBeInstanceOf(TaskCancelledError);
});

test('abort 立刻执行已注册的清理，不等检查点', () => {
  const control = new TaskControl();
  let cleaned = 0;
  control.onAbort(() => {
    cleaned += 1;
  });
  expect(cleaned).toBe(0);
  control.abort();
  expect(cleaned).toBe(1);
});

test('已经 abort 之后注册的清理立即执行', () => {
  const control = new TaskControl();
  control.abort();
  let cleaned = false;
  control.onAbort(() => {
    cleaned = true;
  });
  expect(cleaned).toBe(true);
});
