# 配方：加一条仓库自检

自检脚本住在 `scripts/`：零依赖、不修改文件、通过时只打印一行、失败逐条打印 `文件:行 说明` 并以退出码 1 结束。照 [scripts/check-docs.mjs](../../scripts/check-docs.mjs) 的样子来。

约定与判据要在三处同时体现：脚本本身、它的用例、跑它的地方。缺一处，这条检查就会慢慢烂掉。

## 1. 写脚本

- 文件放 `scripts/check-<主题>.mjs`；只 import Node 内置模块，不引第三方依赖。
- 先定**判据与豁免**：检查什么、什么样算通过、哪些目录或文件跳过。豁免写成显式常量，别散在逻辑里。
- 报错统一 `文件:行 说明`，最后以退出码 1 结束；通过时只打印一行统计。
- **不要自动修复**：仓库约定是「只报不改」，修复由人做。
- 把判定逻辑做成导出的纯函数，`process.argv` 入口用 `if (import.meta.url === pathToFileURL(process.argv[1]).href)` 之类包住——被 import 时不执行。

## 2. 配用例

在 `test/scripts/` 加 `<脚本名>.test.ts`，至少覆盖：合规输入、每一种违规各一条、豁免的边界。用例直接调纯函数，不进 `scripts/` 里的 CLI 入口。

## 3. 接进自检与 CI

- [AGENTS.md](../../AGENTS.md) 的「改完必须自检」加一行命令；
- [.github/workflows/verify.yml](../../.github/workflows/verify.yml) 的 `check` 作业加一步；
- 若检查需要依赖已安装，确认 CI 在跑它之前已经 `yarn install`。

## 4. 验证

- `node scripts/check-<主题>.mjs` 在干净仓库上通过（打印一行）；
- 故意造一条违规，确认它报出正确的位置并以退出码 1 结束；
- `yarn test:main` 里新用例通过；
- `node scripts/check-docs.mjs` 通过（新脚本若带了文档，链接与锚点要成立）。
