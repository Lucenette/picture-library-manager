import { builtinModules } from 'node:module';

import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** 被两份 tsconfig 覆盖、可以开类型感知规则的文件 */
const TYPED_FILES = ['src/**/*.ts', 'src/**/*.vue', 'test/**/*.ts'];
/** 渲染进程：浏览器全局，且不得引用 Node 内置模块 */
const RENDERER_FILES = ['src/renderer/**/*.ts', 'src/renderer/**/*.vue', 'test/renderer/**/*.ts'];
/** 渲染进程不许引的内置模块；electron 按既有设计放行 */
const BUILTINS = [...new Set(builtinModules.flatMap((name) => [name, 'node:' + name]))];

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', 'src/static/default-script.js'] },
  { files: ['**/*.{js,mjs,cjs,ts,vue}'], ...js.configs.recommended },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.{ts,vue}'] })),
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: TYPED_FILES })),
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,cjs,ts,vue}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': ['error', 'always'],
      'block-spacing': ['error', 'always'],
    },
  },
  {
    files: TYPED_FILES,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      curly: ['error', 'all'],
      'no-restricted-syntax': ['error',
        { selector: 'ImportNamespaceSpecifier', message: '禁止 import * as，改用具名导入' },
        { selector: 'ExportNamespaceSpecifier', message: '禁止 export * as，改用具名导出' },
        { selector: 'ExportAllDeclaration', message: '禁止 export *，改用具名导出' },
      ],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        pathGroups: [
          { pattern: '@common/**', group: 'internal', position: 'before' },
          { pattern: '@/**', group: 'internal', position: 'after' },
          { pattern: '@scripts/**', group: 'internal', position: 'after' },
          { pattern: '@test/**', group: 'internal', position: 'after' },
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
    },
  },
  {
    files: RENDERER_FILES,
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: BUILTINS, message: '渲染进程不得引用 Node 内置模块（electron 除外）' }] }],
    },
  },
  {
    files: ['src/main/database/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@/ups', '@/ups/*'], message: 'database 不得依赖 @/ups' }] }],
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/main/log/**'],
    rules: { 'no-console': 'error' },
  },
  {
    // 这三处的 require 是有意写法：图像依赖用 require 拿，不交给打包器内联
    files: ['src/main/image/thumbnail-sharp.ts', 'src/main/image/walk.ts', 'src/main/script/compile.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
