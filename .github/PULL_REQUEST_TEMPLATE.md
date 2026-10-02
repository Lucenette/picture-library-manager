## 这个 PR 做了什么

<!-- 一两句话说明改动与动机 -->

关联 Issue：#

## 改动范围

- [ ] 主进程（`src/main`）
- [ ] 渲染进程（`src/renderer`）
- [ ] 共享契约（`src/common`）
- [ ] 构建 / 打包配置
- [ ] 文档

## 改动类型

- [ ] 修复
- [ ] 新功能
- [ ] 重构（行为不变）
- [ ] 性能
- [ ] 文档
- [ ] 依赖升级

## 自检

- [ ] `node_modules/.bin/tsc -p tsconfig.node.json` 通过
- [ ] 渲染进程 `.ts` 类型检查通过
- [ ] `.vue` 能通过 `@vue/compiler-sfc` 编译
- [ ] 所有 `@/`、`@common/` 导入都指向真实文件
- [ ] 符合 [AGENTS.md](../AGENTS.md)：无 `import *`、控制语句均带大括号、渲染进程未引用 Node 模块
- [ ] `yarn test` 通过；规则内的改动带了对应测试（判据见 [AGENTS.md](../AGENTS.md) 的「测试覆盖规则」）

## 手工验证

<!-- 涉及主进程 / 窗口 / worker / IPC 时必填：静态检查通过不等于功能正常 -->

- [ ] 已重启 `yarn dev` 并手工走通受影响链路
- [ ] 未做手工验证（请说明原因）

验证过的路径：

## 文档

- [ ] 已同步 `README.md` 功能列表（面向用户的行为变了）
- [ ] 已同步 `docs/ARCHITECTURE.md`（结构或数据流变了）
- [ ] 已同步 `docs/SCRIPTING.md`（脚本接口变了）
- [ ] 已在 `CHANGELOG.md` 的 `[未发布]` 段补充条目
- [ ] 不涉及文档
