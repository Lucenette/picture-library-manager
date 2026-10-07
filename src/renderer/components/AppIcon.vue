<template>
  <component :is="ICONS[name]" />
</template>

<script setup lang="ts">
import { ICONS, type IconName } from './icons';

/**
 * 图标：按语义名渲染 SVG，是组件里唯一该出现的图标写法。
 *
 * 它**不加任何包裹元素、不写任何尺寸与颜色**——图标本身就是 `1em` 的 SVG、颜色走 `currentColor`，
 * 所以放在哪里就跟哪里的 `font-size` 与 `color`（外层是 `el-icon` 时即它的 `size`）。留一个包裹元素
 * 会在「外层类也带布局属性」的位置上打架（例如平铺视图的 `.tile-cover-empty`），也会把原来
 * `el-icon` 定下的对齐方式改掉。
 */
defineProps<{
  /** 图标语义名，取值见 `icons.ts` 的映射表 */
  name: IconName;
}>();
</script>
