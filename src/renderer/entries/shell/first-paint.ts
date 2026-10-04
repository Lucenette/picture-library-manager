/**
 * 首帧底色与深色基础样式：四个入口 HTML 都要有，但只有这一份定义。
 *
 * 外链 CSS 与组件样式都晚于首次绘制，页面又是按需加载的，少了它窗口会先闪白底 → 冒出滚动条 →
 * 才变深色；所以它**必须内联**在 HTML 里，由 `electron.vite.config.ts` 的 `firstPaint` 插件注入到
 * 各入口 HTML 的 `<!-- first-paint -->` 占位处，而不是在四个 HTML 里各抄一份。
 *
 * 这个文件**不许 import 任何东西**：构建配置（Node 侧）会直接读它，不能被浏览器入口引用。
 *
 * 下面两处色值是**有意写死**的：这段样式要早于外链 CSS 生效，那时 `styles/theme.css` 的令牌还不存在
 * （`var(--win-bg, #1e1f22)` 的兜底同理，底色平时由主进程按窗口带进来）。改主色调时跟 theme.css 的
 * `--app-bg-page` / `--app-text-regular` 一起改。
 */
export const FIRST_PAINT = `
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: var(--win-bg, #1e1f22);
        color: #d8dadd;
      }

      #app {
        height: 100%;
      }
    </style>
    <script>
      // 窗口自己的底色由主进程作为查询参数带进来（见 window-manager 的 getWindowUrl）
      const winBackground = new URLSearchParams(window.location.search).get('bg');
      if (winBackground) {
        document.documentElement.style.setProperty('--win-bg', winBackground);
      }
    </script>
`;
