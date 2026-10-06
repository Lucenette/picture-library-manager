# 平铺视图悬停放大的阴影被裁、边缘图片被切

**状态**：待办

## 背景

平铺视图的卡片悬停时把封面放大（layer-0 到 1.14）并加阴影，见 `src/renderer/components/TileBoard.vue` 的 `.tile-cover:hover .tile-cover-img` 一族规则。

用户实际遇到两点：悬停放大后看不到阴影；最左/最右一列的图片放大后被切边。容器侧：`.tile-board :deep(.el-scrollbar__wrap) { overflow-x: hidden }` 会裁掉横向溢出，`.tile-content` 的左右内边距只有 `--app-space-8`（8px），留不出放大与阴影需要的余量。

## 事项

- 给滚动内容留出放大 + 阴影所需的空间（加大内边距或加负外边距），或让横向溢出可见；确认阴影四边都完整。
- 复现：平铺视图，鼠标移到最左 / 最右一列的卡片上。
- 验证：悬停放大后阴影完整，首列与末列不被裁。
