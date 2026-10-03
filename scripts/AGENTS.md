# AGENTS.md — scripts/

仓库自检脚本住在这一层，职责是**把约定变成可执行的检查**：零依赖、不修改文件、可以单独运行。

## 约定

- **只 import Node 内置模块**，不引第三方依赖——脚本在依赖装好之前也该能跑（`check-docs.mjs` 就是零依赖）。
- **只报不改**：不做自动修复。修由人做，脚本的退出码只表达「过 / 不过」。
- **一个脚本一条不变量**；命名 `check-<主题>.mjs`，从源码生成目录的用 `gen-<主题>.mjs`。
- 通过时只打印一行统计、退出码 0；失败逐条打印 `文件:行 说明`、退出码 1。
- 判定逻辑做成导出的纯函数；`process.argv` 入口用 `import.meta.url` 比较包住，被 import 时不执行。
- 路径从仓库根解析（`resolve(import.meta.dirname, '..')`），不依赖调用时的当前目录。

## 用例与接线

- 每个脚本在 `test/scripts/<脚本名>.test.ts` 有对应用例，至少覆盖合规输入、每一种违规、豁免边界；用例调纯函数，不进 CLI 入口。
- 新脚本同时接进两处：根 [AGENTS.md](../../AGENTS.md) 的「改完必须自检」与 [.github/workflows/verify.yml](../../.github/workflows/verify.yml) 的 `check` 作业。只写脚本不接线，它不会被跑到。
- 完整步骤见 [docs/cookbook/adding-a-repo-check.md](../../docs/cookbook/adding-a-repo-check.md)。
