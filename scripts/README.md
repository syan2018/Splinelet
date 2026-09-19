# Scripts 目录

脚本按执行环境和用途分目录。所有命令都从仓库根目录运行；新增脚本应放进对应类别，并使用相对当前文件可解析的 import 与 fixture 路径。

## 常用入口

在仓库根目录运行：

```sh
npm run typecheck
npm test
npm run build
```

- `npm run test:core`：构造链、修改器和打印分层回归。
- `npm run test:export`：通用 3MF 与 Bambu 3MF 回归。
- `npm test`：运行 `tests/unit/` 中全部不依赖私有工程或历史产物的测试。
- `npm run format:check`：只检查格式，不修改文件。

## 目录

- `tests/unit/`：可直接用 Node 运行的核心、几何和导出回归。
- `tests/browser/`：隔离浏览器或 Playwright 注入脚本；不要在日常工程标签页运行。
- `tests/fixtures/`：进入版本库的最小可复现测试数据。
- `examples/`：样例构建与导出工具。
- `validation/`：Python、Blender 或外部格式验证。
- 根目录的 `agent-server.mjs`：本机 Agent HTTP 桥接。

移动脚本时必须成组更新相对 import、fixture、输出路径、文档命令和 `package.json`，并用 `node --check` 覆盖 JavaScript 脚本。
