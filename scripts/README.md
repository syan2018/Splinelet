# Scripts 目录

脚本按执行环境和用途分目录。所有命令都从仓库根目录运行；新增脚本应放进对应类别，并使用相对当前文件可解析的 import 与 fixture 路径。

## 常用入口

在仓库根目录运行：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm build
```

- `pnpm test:core`：构造链、修改器和打印分层回归。
- `pnpm test:export`：通用 3MF 与 Bambu 3MF 回归。
- `pnpm test`：运行 `tests/unit/` 中全部不依赖私有工程或历史产物的测试。
- `pnpm format:check`：只检查格式，不修改文件。

交互回归使用隔离浏览器与独立开发端口。`tests/browser/test-pointer-lifecycle.cjs` 接收一个 Playwright `page`，自建工程并验证选择工具不改几何、节点多选／全选移动、拖动释放、取消、失焦和撤销；`tests/browser/test-saving-browser.cjs` 验证手动写文件与自动恢复草稿的边界。不要在日常工程标签页注入这些脚本。

## 目录

- `tests/unit/`：可直接用 Node 运行的核心、几何和导出回归。
- `tests/browser/`：隔离浏览器或 Playwright 注入脚本；每个脚本必须自建测试数据或接收 `tests/fixtures/` 中的已提交 fixture，不能依赖先前脚本、当前页面工程或本机私有文件。不要在日常工程标签页运行。
- `tests/fixtures/`：进入版本库的最小可复现测试数据。
- `examples/`：样例构建与导出工具。
- `validation/`：Python、Blender 或外部格式验证。
- 根目录的 `agent-server.mjs`：本机 Agent HTTP 桥接。

移动脚本时必须成组更新相对 import、fixture、输出路径、文档命令和 `package.json`，并用 `node --check` 覆盖 JavaScript 脚本。
