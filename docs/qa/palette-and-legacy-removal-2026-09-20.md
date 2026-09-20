# 色卡崩溃与旧路径移出 · 2026-09-20

此前漏测了原色卡页面。真实原工作区载入 Sandrone 后打开色卡，`CreationSwatchDelete` 调用旧 `swatchOwners`，对 V4 投影不存在的 `featureSwatches` 调用 `Object.values`，导致未捕获 React 异常和空白界面。复现记录为 `outputs/v4-qa/palette-repro-2026-09-20.log`，错误为 `Cannot convert undefined or null to object`。

修复不补造旧字段。`projectCreationView` 从 DocumentV4 的默认颜色与局部颜色引用生成冻结的使用部件列表，删除确认组件只读取该列表。失效输出的持久引用也计入，默认与局部引用按部件去重，和规范删除命令保持一致。

用户要求先提交全部本地工作，再通过移动破坏旧模块引用。全部本地工作已提交为 `d201d6c`；它包含此前候选界面阶段遗留的未提交文件，先前将这些称为“无关改动”不准确。

随后实际移动旧模块，原路径没有保留 re-export、shim 或回退。文件级映射见[移动清单](../../tasks/editor-model-v4-refactor/legacy-path-moves-2026-09-20.json)：

- 旧 creation / modifier / path-transfer 命令及颜色写入逻辑移到 `scripts/tests/legacy/`，只允许历史行为基线测试导入。
- 旧 Model Worker、旧 IndexedDB 持久化和候选界面及专用用例移为 `.retired` 历史源码，不再参与编译、构建和用例注册。移除 runner 的 `--suite v4` 与候选导航分支。
- 移动暴露的生产依赖是旧 workspace 模块中的通用 FileWriter。串行写入器已独立到 `src/lib/persistence/file-writer.mjs`，不恢复旧数据库模块。断链证据为 `legacy-links-broken-runtime-2026-09-20.log` 的 `ERR_MODULE_NOT_FOUND`；修复后的文件写入专项通过。
- 旧行为测试只修正导入位置；比较器中的复现测试 SHA 随导入路径变化更新，旧几何结果、基线样例和阈值未修改。

色卡专项 `node scripts/tests/browser/smoke/test-v4-original-studio.cjs --palette-only` 已通过，覆盖打开、重命名、撤销还原文档、引用颜色的删除确认与取消，浏览器错误数组为空。

- `palette-regression-after-2026-09-20.log`：完整原工作区浏览器回归 PASS，包含色卡打开/确认、Sandrone 编辑、保存、重新打开与三维结果。
- `legacy-removal-check-all-2026-09-20.log`：类型、lint 与 129 项单元测试 PASS；格式检查仅发现迁移后的一处测试排版，已修正。
- `legacy-removal-final-checks-2026-09-20.log`：后续完整格式、Rust format/check、Web 与桌面前端构建均通过，退出码 0。没有为了重复一个格式修正而重跑未改行为的全部单元测试。
- 24 处原文件路径均不存在，移动目标全部保留；`src/` 和 `app/` 中没有历史目录导入、旧命令/颜色/持久化模块引用或候选全局入口。
- `palette-native-release-2026-09-20.log`：原生 release 构建 PASS；`native-default-entry-2026-09-20T12-37-52.505Z-67640/manifest.json`：新桌面程序中的内嵌 Sandrone 和 gold 均通过色卡打开、控制柄编辑/撤销、保存 V4 副本和重新打开，原件不变。绑定文件的实际 Ctrl+S 也通过。
