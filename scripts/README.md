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
- `test-spline-edit.mjs`：精确双柄样条、坐标往返、矩阵变换、来源保留与整批失败。
- `test-curve-pipeline.mjs`：镜像、四向阵列、显式构面、中心留空、对称性、阶段顺序、失效隔离与恢复；`test-radial-array.mjs` 检查构面后的阵列、孔与实体。
- `test-endpoint-snap.mjs`：组合变换接缝、精确接合、自由端点、分叉目标排除、屏幕距离与吸附滞回、非原点轴、停用修改器和源数据不变性。
- `pnpm format:check`：只检查格式，不修改文件。
- `pnpm check`：类型、lint、Node 单测与前端格式检查。
- `pnpm build:all`：Web 与桌面前端构建。
- `pnpm check:all`：上述检查、Rust 格式与编译检查、双端前端构建；需要 Rust 和当前平台 Tauri 系统依赖。
- `pnpm desktop:release`：构建免安装原生发布程序，跳过安装包生成；Windows 输出 `src-tauri/target/release/splinelet.exe`，运行时需要 WebView2。`desktop:build` 只构建前端，不能代替该发布检查。

交互回归使用隔离浏览器与独立开发端口。`tests/browser/test-pointer-lifecycle.cjs` 接收一个 Playwright `page`，自建工程并验证选择工具不改几何、节点多选／全选移动、拖动释放、取消、失焦和撤销；`tests/browser/test-saving-browser.cjs` 验证手动写文件与自动恢复草稿的边界。`tests/browser/test-object-move-browser.cjs` 自建多源编组与独立部件，验证 H 整组／多部件移动、V 禁移、单次撤销、阈值与取消生命周期，以及面／线／节点／空白右键平移保持工程和选区。不要在日常工程标签页注入这些脚本。

后续 V4 验收按[编辑模型重构方案](../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)扩展：U01–U06 验证普通描线、分区、编组无需技术配置，A 项验证对象身份和各数据域转换。它们目前是设计目标，现有回归通过不代表已覆盖 V4；各工作包实现时再加入对应最小 fixture 与测试。

具体分发和验收入口见 [V4 任务总控](../tasks/editor-model-v4-refactor/README.md)。[P01 验证工作包](../tasks/editor-model-v4-refactor/01-validation-2026-09-19.md)提供统一浏览器入口：先安装 `pnpm exec playwright install chromium` 并构建对应前端，再运行 `pnpm test:browser --suite legacy --target web` 或 `--target desktop`；可用 `--case <用例名>` 选择单项。runner 自建隔离服务、浏览器和 context，输出构建摘要、fixture 摘要及失败证据到 `outputs/v4-qa/`；不连接用户页面。原简化 V4 候选页面入口已撤销，`--suite v4` 的历史用例需要改为原工作区的接入验收，当前不能用来证明功能保持或完成重构。未登记的 case 明确失败，不算跳过通过。`check:all` 不包含浏览器或 Tauri 原生交互验收，桌面静态前端测试也不等于原生文件会话验收。

`scripts/tests/browser/smoke/test-sandrone-restored-ui.cjs` 用于原工作区的实际 Sandrone 回归，可传 `--target web` 或 `--target desktop-frontend`、独立 `--port` 和 `--output`。它需要内置样例及本地补充 gold 样例；具体本地范围、命令和证据见[恢复验收快照](../docs/qa/studio-ui-restoration-2026-09-19.md)，不作为通用 hermetic suite。

`tests/browser/test-property-navigation.cjs` 接收隔离 `page` 和 `tests/fixtures/shoulder-region.json` 工程对象，检查顶栏主菜单、左右栏入口归属、竖排属性分组、全局分类不随选区跳转、工具与选区属性范围、高级构造编辑器及源曲线导出入口。`test-selection-scope-browser.cjs` 同样使用此 fixture，覆盖区域属性提交、切换选区时的输入草稿、源线选择与恢复后实体导出；选择工具拖动不修改几何。

## 目录

`examples/draw-cup-emblem.mjs` 导出 `drawCupEmblem(call)`，只通过公开 API 在实例工程副本上创建参数化纹样。`tests/browser/test-agent-spline-authoring.cjs` 接收隔离 Playwright page 和可选输出目录，自行载入已提交的 `public/sandrone-example.spl`，验证开放的 1/8 轮廓跨相邻扇区连接构面、母线编辑、拖动中的派生预览、断口诊断与平面/立体切换、一步撤销、参数控件、原杯身保留、保存重开及实体/3MF 导出。只能在独立测试端口和新 browser context 执行。

`tests/browser/test-endpoint-snapping.cjs` 同样接收隔离 page 和可选截图目录，仅在实例工程的测试副本上用真实指针验证保持接缝、Alt 解除、断口吸附修复、一步撤销、Esc 取消及关闭吸附。不得连接用户页面或写入用户绑定的文件。

- `build/`：供 Vite 配置导入的构建辅助模块；`vite-public-assets.ts` 服务和复制兼容静态资源，保留描线 Worker 的绝对 URL。
- `tests/unit/`：可直接用 Node 运行的核心、几何和导出回归。
- `tests/browser/`：隔离浏览器或 Playwright 注入脚本；每个脚本必须自建测试数据或接收 `tests/fixtures/` 中的已提交 fixture，不能依赖先前脚本、当前页面工程或本机私有文件。不要在日常工程标签页运行。
- `tests/fixtures/`：进入版本库的最小可复现测试数据。
- `examples/`：样例构建与导出工具。
- `validation/`：Python、Blender 或外部格式验证。
- 根目录的 `agent-server.mjs`：本机 Agent HTTP 桥接。

移动脚本时必须成组更新相对 import、fixture、输出路径、文档命令和 `package.json`，并用 `node --check` 覆盖 JavaScript 脚本。
