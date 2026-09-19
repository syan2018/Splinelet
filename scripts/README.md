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
pnpm desktop:build
pnpm desktop:format:check
pnpm desktop:check
```

- `pnpm test:core`：构造链、修改器和打印分层回归。
- `pnpm test:export`：通用 3MF 与 Bambu 3MF 回归。
- `pnpm test`：运行 `tests/unit/` 中全部不依赖私有工程或历史产物的测试。
- `test-project-format.mjs`：验证 `.spl` 确定性往返、旧 JSON 导入、资源哈希与损坏包拒绝。
- `pnpm format:check`：只检查格式，不修改文件。
- `pnpm check`：类型、lint、Node 单测与前端格式检查。
- `pnpm build:all`：Web 与桌面前端构建。
- `pnpm check:all`：上述检查、Rust 格式与编译检查、双端前端构建；需要 Rust 和当前平台 Tauri 系统依赖。
- `pnpm desktop:release`：构建免安装原生发布程序，跳过安装包生成；Windows 输出 `src-tauri/target/release/splinelet.exe`，运行时需要 WebView2。`desktop:build` 只构建前端，不能代替该发布检查。

交互回归使用隔离浏览器与独立开发端口。`tests/browser/test-pointer-lifecycle.cjs` 接收一个 Playwright `page`，自建工程并验证选择工具不改几何、节点多选／全选移动、拖动释放、取消、失焦和撤销；`tests/browser/test-saving-browser.cjs` 验证手动写文件与自动恢复草稿的边界。不要在日常工程标签页注入这些脚本。

`tests/browser/test-property-navigation.cjs` 接收隔离 `page` 和 `tests/fixtures/shoulder-region.json` 工程对象，检查竖排属性分组、全局分类不随选区跳转、工具与选区属性范围、高级构造编辑器及源曲线导出入口。`test-selection-scope-browser.cjs` 同样使用此 fixture，覆盖区域属性提交、切换选区时的输入草稿、源线选择与恢复后实体导出；选择工具拖动不修改几何。

## 目录

- `build/`：供 Vite 配置导入的构建辅助模块；`vite-public-assets.ts` 服务和复制兼容静态资源，保留描线 Worker 的绝对 URL。
- `tests/unit/`：可直接用 Node 运行的核心、几何和导出回归。
- `tests/browser/`：隔离浏览器或 Playwright 注入脚本；每个脚本必须自建测试数据或接收 `tests/fixtures/` 中的已提交 fixture，不能依赖先前脚本、当前页面工程或本机私有文件。不要在日常工程标签页运行。
- `tests/fixtures/`：进入版本库的最小可复现测试数据。
- `examples/`：样例构建与导出工具。
- `validation/`：Python、Blender 或外部格式验证。
- 根目录的 `agent-server.mjs`：本机 Agent HTTP 桥接。

移动脚本时必须成组更新相对 import、fixture、输出路径、文档命令和 `package.json`，并用 `node --check` 覆盖 JavaScript 脚本。
