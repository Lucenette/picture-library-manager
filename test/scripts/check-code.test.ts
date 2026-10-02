import { test, expect } from 'vitest';

import { lintText } from '@scripts/check-code.mjs';

function messages(rel: string, content: string): string {
  return lintText(rel, content).join('\n');
}

test('干净的源码没有问题', () => {
  expect(messages('src/main/_probe.ts', 'export const x = 1;\n')).toBe('');
});

test('识别无法解析的导入', () => {
  const content = "import { nope } from '@/definitely/missing';\nexport const x = nope;\n";
  expect(messages('src/main/_probe.ts', content)).toContain('导入无法解析');
});

test('识别没有大括号的控制语句', () => {
  const content = 'export function f(ok: boolean): number {\n  if (ok) return 1;\n  return 0;\n}\n';
  expect(messages('src/main/_probe.ts', content)).toContain('控制语句必须带大括号');
});

test('合法的 .vue 脚本与模板能编译通过', () => {
  const content = '<template><div>{{ a }}</div></template>\n<script setup lang="ts">\nconst a = 1;\n</script>\n';
  expect(messages('src/renderer/_probe.vue', content)).toBe('');
});

test('识别编译不过的 .vue 模板', () => {
  const content = '<template><div>{{ 1 + }}</div></template>\n<script setup lang="ts">\nconst a = 1;\n</script>\n';
  expect(messages('src/renderer/_probe.vue', content)).toMatch(/模板编译失败|SFC 解析失败/);
});
