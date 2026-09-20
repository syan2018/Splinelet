# 旧编辑路径基线与退役源码

2026-09-20 从产品源码移出。原位置不留转发模块，产品代码不得导入本目录。

- `creation-commands.mjs`、`creation-colors.mjs`、`modifier-commands.mjs`、`creation-path-transfer.mjs` 仅供旧版本行为基线单元测试。它们可读取共用数学和旧格式模块，但不是 V4 的命令适配层。
- `*.retired` 与 `retired-candidate/` 是不可执行的历史源码，保留用于追溯；不参与 TypeScript、构建、浏览器用例注册或测试发现。包括废弃 Model Worker、旧 IndexedDB 持久化，以及已被否决的候选前端及其专用测试。
- 当前原界面回归运行 `node scripts/tests/browser/smoke/test-v4-original-studio.cjs`；当前原生验证运行 `node scripts/tests/native/test-v4-default-entry.mjs`。旧 `--suite v4` 候选入口已移除。
- 候选页面曾使用的全局 API 挂载器移到 `scripts/tests/helpers/v4-browser.mjs`，仅测试规范 API 的传输合同，不再是生产页面入口。

逐文件位置见[移动映射](../../../tasks/editor-model-v4-refactor/legacy-path-moves-2026-09-20.json)。通用串行写入器现在独立位于 `src/lib/persistence/file-writer.mjs`，不含旧工程数据库逻辑。
