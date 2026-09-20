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
- `test-spline-edit.mjs`：精确双柄样条、坐标往返、矩阵变换、来源保留与整批失败；共用提案解析器在冻结的几何/归属视图上工作，不分配 ID 或修改展示数据。
- `test-v4-path-replacement.mjs`：精确源曲线替换，验证带 pose 的反向拓扑、端点和双柄、开闭及节点数变化、单点继续编辑、路径身份与构造保留、一次撤销，以及共享/关系/过期/整批失败保护。
- `test-v4-spline-intents.mjs`：原精确样条整批提交的规范接线，覆盖新建/矩阵变换/辅助线与边界/洞、无变化提交 ID、跨部件拒绝、锁定导致整批回滚和一次撤销；原根浏览器检查真实 spline_apply、回读、重做与保存回读。
- `test-v4-region-outline.mjs`：承托外形的规范派生算子，先合并分区再移除内部孔洞，验证断开外形、输入不变、输入顺序稳定、空/阻塞传播及真实构造图随源编辑重新求值。
- `test-v4-region-path-uses.mjs`：线条用途读侧包含已发布 Fill 的普通边界、多个 Source 成员及省略 pathIds 的来源；区分洞的私有 Fill 与真正多用途，并保持未完成绘制识别不变。
- `test-v4-path-roles.mjs`：原 roles 适配为规范成员/构造命令，覆盖边界、参考、挖洞、分区往返，新边界加入普通 even-odd 输入，无构面时建立边界，过期视图、批量失败回滚和预备命令；复杂派生来源不误报为参考线。
- `test-v4-region-path-membership.mjs`：暂停/恢复构面输入成员时保留 even-odd 孔洞、源几何及区域身份；覆盖一次撤销/重做、共享输入隔离、多用途拒绝、空输入、复制重映射、缺失引用阻断及默认界面不展开内部筛选；用途往返后继续普通绘制、暂停成员改为开放路径并重新闭合仍保持原输入关系。
- `test-v4-support-command.mjs`：承托命令保留原来源并引用外形、边距与厚度，检查顶面依附/新最底打印层、制造零件归属、原子拒绝、预备命令确认/失效和一次撤销。原根浏览器另检查实际预览、取消、确认、撤销重做及保存回读。
- `test-curve-pipeline.mjs`：镜像、四向阵列、显式构面、中心留空、对称性、阶段顺序、失效隔离与恢复；`test-radial-array.mjs` 检查构面后的阵列、孔与实体。
- `test-endpoint-snap.mjs`：组合变换接缝、精确接合、自由端点、分叉目标排除、屏幕距离与吸附滞回、非原点轴、停用修改器和源数据不变性。
- `pnpm format:check`：只检查格式，不修改文件。
- `pnpm check`：类型、lint、Node 单测与前端格式检查。
- `pnpm build:all`：Web 与桌面前端构建。
- `pnpm check:all`：上述检查、Rust 格式与编译检查、双端前端构建；需要 Rust 和当前平台 Tauri 系统依赖。
- `pnpm desktop:release`：构建免安装原生发布程序，跳过安装包生成；Windows 输出 `src-tauri/target/release/splinelet.exe`，运行时需要 WebView2。`desktop:build` 只构建前端，不能代替该发布检查。

交互回归使用隔离浏览器与独立开发端口。`tests/browser/test-pointer-lifecycle.cjs` 接收一个 Playwright `page`，自建工程并验证选择工具不改几何、节点多选／全选移动、拖动释放、取消、失焦和撤销；`tests/browser/test-saving-browser.cjs` 验证手动写文件与自动恢复草稿的边界。`tests/browser/test-object-move-browser.cjs` 自建多源编组与独立部件，验证 H 整组／多部件移动、V 禁移、单次撤销、阈值与取消生命周期，以及面／线／节点／空白右键平移保持工程和选区。不要在日常工程标签页注入这些脚本。

后续 V4 验收按[编辑模型重构方案](../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)扩展：U01–U06 验证普通描线、分区、编组无需技术配置，A 项验证对象身份和各数据域转换。它们目前是设计目标，现有回归通过不代表已覆盖 V4；各工作包实现时再加入对应最小 fixture 与测试。

V4 原工作区源操作的模块回归：`tests/unit/test-v4-source-intent-batches.mjs` 验证多点/模式批量事务、共享目标与 Preview；`test-v4-path-extension.mjs` 验证精确头尾续画、拟合闭合、世界/像素坐标和迟到结果；`test-v4-path-metadata.mjs` 验证名称/显示批量修改不改变几何或归属。这些由 `pnpm test` 自动运行，不代替原界面的实际接线验收。

`test-v4-start-path.mjs` 验证首点显示、移动、保存重开、续画与每次落点撤销；`test-v4-single-vertex-path.mjs` 验证零边 Path 的结构、软引用诊断、复制和共享源转移闭包。旧单点工程的 V1–V3 导入保真由 `test-v4-migration.mjs` 覆盖。

`test-v4-path-deletion.mjs` 覆盖删除影响、共享几何保留、失效构造保存和撤销；`test-v4-path-geometry-command.mjs` 覆盖重拟合/直连的身份、权限与原子性；`test-v4-path-intents.mjs` 从原像素视图核对反向重拟合、原直连控制柄行为及坏路径修复入口。这些同样纳入 `pnpm test`。

`test-v4-path-node-deletion-command.mjs` 对照原节点删除拟合，覆盖稳定身份、闭合起点、单点、共享拓扑与原子拒绝；`test-v4-path-merge.mjs` 对照原四端点合并，覆盖重合焊接和引用范围；`test-v4-node-and-merge-intents.mjs` 验证像素视图适配、同部件跨 Sketch 合并、重新求值和一次撤销。这些是命令模块验证，不能替代原画布事件接线验收。

`node scripts/tests/unit/test-v4-legacy-equivalence.mjs` 比较内置 Sandrone 的源 cubic、求值区域与逐区域属性，并检查修改来源后的动态结果；可选首个位置参数或 `SPLINELET_LEGACY_EQUIVALENCE_PROJECT` 环境变量指定额外 `.spl`。测试只读原件，额外文件不作为单元测试的隐式依赖。这是导入模块验证，不能替代原界面的文件打开、手势编辑和保存重开验收。

具体分发和验收入口见 [V4 任务总控](../tasks/editor-model-v4-refactor/README.md)。[P01 验证工作包](../tasks/editor-model-v4-refactor/01-validation-2026-09-19.md)提供统一浏览器入口：先安装 `pnpm exec playwright install chromium` 并构建对应前端，再运行 `pnpm test:browser --suite legacy --target web` 或 `--target desktop`；可用 `--case <用例名>` 选择单项。runner 自建隔离服务、浏览器和 context，输出构建摘要、fixture 摘要及失败证据到 `outputs/v4-qa/`；不连接用户页面。原简化 V4 候选页面入口已撤销，`--suite v4` 的历史用例需要改为原工作区的接入验收，当前不能用来证明功能保持或完成重构。未登记的 case 明确失败，不算跳过通过。`check:all` 不包含浏览器或 Tauri 原生交互验收，桌面静态前端测试也不等于原生文件会话验收。

`scripts/tests/browser/smoke/test-sandrone-restored-ui.cjs` 用于原工作区的实际 Sandrone 回归，可传 `--target web` 或 `--target desktop-frontend`、独立 `--port` 和 `--output`。它需要内置样例及本地补充 gold 样例；具体本地范围、命令和证据见[恢复验收快照](../docs/qa/studio-ui-restoration-2026-09-19.md)，不作为通用 hermetic suite。

`tests/browser/test-property-navigation.cjs` 接收隔离 `page` 和 `tests/fixtures/shoulder-region.json` 工程对象，检查顶栏主菜单、左右栏入口归属、竖排属性分组、全局分类不随选区跳转、工具与选区属性范围、高级构造编辑器及源曲线导出入口。`test-selection-scope-browser.cjs` 同样使用此 fixture，覆盖区域属性提交、切换选区时的输入草稿、源线选择与恢复后实体导出；选择工具拖动不修改几何。

## 目录

`test-v4-point-gesture.mjs` 检查原画布 `(curve, point)` 命中到 V4 源身份的拖动适配：捕获基线、批量节点、闭合接缝、部件旋转、控制柄连续性、取消与一次撤销；同时检查整线位移的闭合线、旋转部件、共享节点去重和所有控制柄形状。原源路径和节点/柄 DOM 已抽取为 `SourcePathLayers` / `SourceNodeHandles`，默认 Studio 仍绑定原事件。Sandrone 浏览器 fixture 使用同一 DOM 和 V4 手势 hook，真实鼠标验证节点及整线预览/提交/撤销、控制柄 Esc、4px 门槛、Shift 限轴和捕获丢失取消；不替代整条路径移动、吸附或续画的默认根接线。

`test-v4-studio-host.mjs` 用内置 Sandrone 验证参考图的规范资源字节、像素坐标及 Blob URL 生命周期：替换后释放旧 URL，失败保留旧资源，关闭幂等，保存容器不混入显示 URL。`test-v4-studio-file-writer.mjs` 验证已选择的浏览器句柄/桌面路径写入适配，包括授权拒绝、串行写入、abort 恢复与路径路由；原生磁盘写入在此使用注入函数，不冒充原生验收。

原组件浏览器脚本另含 `v4-sandrone-reference.mjs`：读取内置样例，在原节点面板编辑并撤销，通过隔离 context 所属临时 origin 的 OPFS 真正写入 V4 副本，再以浏览器文件句柄重开，验证图片解码、资源释放和文档等价。它不读写用户工程绑定，不替代默认工作区或 Tauri 原生文件验收。

`node scripts/tests/browser/smoke/test-v4-original-studio.cjs` 在临时端口和全新浏览器 context 中，将 `StudioHost` 注入完整原 `StudioApp`，载入内置 Sandrone，检查原布局、源编辑、精确样条、分组/排序、用途按钮往返、承托预览、撤销和原保存按钮写入 OPFS 副本；读取实际保存字节验证 V4 文档，并覆盖新旧工程打开。它使用真实 Worker 和原样式，不操作用户页面。用途操作等待实际宿主修订号后再验证撤销，不能用异步 API 谓词充当提交屏障。默认入口尚未切换，工程宽度、ModelWorkspace 等剩余旅程不能据此签收。

该脚本也通过原文件菜单打开实际 OPFS 中的 V4/旧版样例，验证换工程清空历史、V4 绑定保留、旧版只导入为副本；损坏字节不能替换当前工程。系统文件选择器以返回私有 origin 句柄的测试端口代替，之后走原页面真实读取与统一打开管线；不代表原生操作系统对话框验收。“载入示例工程”菜单共用同一 V4 打开入口。

`test-v4-new-reference-project.mjs` 验证从图片创建空 V4 文档、独立资源字节、居中毫米坐标和容器往返。完整原 Studio 浏览器脚本进一步通过原图片 input 新建工程，验证旧路径/部件/历史/绑定清空、真实 Worker 分析底图，以及原保存按钮将新图工程另存到独立 OPFS 文件。系统保存选择器仅返回隔离目标句柄。

完整原根脚本还覆盖新图上的真实落点描绘：Alt 直连两段、手动模式闭合、原快捷键与单次撤销/重做、候选区域命中及保存。原快捷键在 Alt 按下时不处理字母键，测试必须释放 Alt 后操作 C；不能据此改变原键盘约定。V4 无厚度定义的闭合区域仍可作为候选点击，只有已赋值且明确禁用的区域被过滤。

`test-v4-studio-session.mjs` 验证原工作区根会话控制器：会话订阅发出同一运行时的只读展示句柄，源/构造命令共用历史，打开时编辑与文件版本对齐，预览不写文件，实际 V4 编码保存、换文件后的迟到写入、恢复及失效恢复保护。`test-v4-persistence.mjs` 同时检查打开的显式初始版本/dirty、取消或相同版本同步不置脏、旧工程始终另存为，以及输入失败时保留原文件状态。原组件浏览器 fixture 已通过 `useSyncExternalStore` 订阅此控制器，不自行维护另一份可写 Project；仍不是默认根工作区完整切换验收。

`test-v4-node-actions.mjs` 对比原节点操作算法和 V4 源命令的连接方式、直连、批量删点结果，验证稳定身份、错误原子性和一次撤销。原主界面及节点 API 复用这个动作边界；原组件浏览器用例同时挂载 `SplineNodeInspector`，验证实际下拉框、直连/删除按钮、实时派生结果和撤销。

`test-v4-source-runtime.mjs` 验证源编辑、路径命令和修改器共用同一 V4 会话及展示句柄：像素身份映射、固定参考坐标系、拖动按起点重算、派生预览同步、取消不留历史、提交一次撤销，以及换文档/撤销/重复坐标采样后的旧句柄拒绝。运行命令为 `node scripts/tests/unit/test-v4-source-runtime.mjs`；这属于共享运行时验证，尚不代表原主画布回调完成接线。

`test-v4-modifier-intents.mjs` 检查原修改器字段到 V4 算子的所有权、世界/局部坐标、参数引用保护和字段约束；`test-v4-modifier-control-runtime.mjs` 验证只读控件值→原 `modifier_update` 意图→同一 V4 会话→重新求值与一次撤销。它们不替代修改器面板的实际 DOM 接线验收。

`test-v4-modifier-add.mjs` 验证原 `modifier_add` 的纯曲线阶段镜像/阵列：世界坐标转换、发布端口接线、原线不变、一次撤销和错误原子拒绝；已有区域、锁定或不可用曲线不能通过简化入口追加。上述原组件浏览器用例同时验证实际新增阵列、三倍曲线输出、正确前序引用和撤销。构面接合、已有区域的修改器增删排序尚需独立接线，不属于这一项通过范围。

`test-v4-curve-preview.mjs` 检查 V4 当前曲线结果到原画布预览的世界坐标、显式端点拓扑、隐藏、稳定阶段及最终输出失效不回退；`test-v4-curve-preview-runtime.mjs` 检查同步读取、不可变缓存、拖动预览版本、取消与过期句柄拒绝。原组件浏览器用例同时挂载原预览开关、阶段选择和 SVG overlay，验证新增阵列后的六条曲线、切回镜像阶段的两条曲线，以及失效输出的空路径；不替代默认根工作区和完整源拖动旅程。

`node scripts/tests/browser/smoke/test-v4-original-modifier-controls.cjs` 在临时端口和全新浏览器 context 中加载原 `CreationModifiers`、原样式与真实 V4 会话，检查实际数值提交、一次撤销、参数驱动、缺失参数和锁定，并断言卡片样式加载。最小 fixture 为 `tests/fixtures/v4-modifier-controls.mjs`，不读取应用草稿或用户文件；结果与截图位于 `output/playwright/v4-original-modifier-controls/`。这是组件接线验证，不能代替默认根工作区或原生文件旅程。浏览器 CommonJS 脚本使用单独 lint override：允许 require 和 Node 模块导出函数的解构，不将其误判为需要绑定 this 的实例方法；产品 TypeScript 规则保持不变。

`test-v4-import-source-identity.mjs` 严格比较实际旧工程与全部 V4 可写来源，检查路径/边总集合、独立边使用、孤立节点及源列表次序；默认只读内置 Sandrone，可用首个参数指定额外工程。`test-v4-partition-endpoint-join.mjs` 验证分区接边在端点/底面变化后重新求值、禁用与空输入行为。派生接边不能保存为隐藏可写来源。

`tests/unit/test-v4-source-order.mjs` 覆盖导入/容器重开后的源路径与集合顺序、新线追加、排序意图和过期视图；`test-v4-source-organization.mjs` 覆盖整理集合及全局源顺序的原子命令、重叠成员、锁定和一次撤销。它们不替代原树拖放的 UI 接线验收。

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

`test-v4-path-move-equivalence.mjs` 检查真实 Sandrone 头发部件移动后的 69 个求值区域与旧实现等价，并验证旧分区 fixture 的 11 组涂色在全部边界与源线同移后，按稳定输出引用保持几何、颜色和厚度。旧 fixture 的移动后空间样式匹配本身会报歧义，因此该项以移动前已验证的分区单元进行坐标平移作几何基准；不会把旧 fallback 当成正确输出。

`test-v4-endpoint-snap-view.mjs` 检查 V4 当前源视图和已发布曲线实例到原端点吸附 DTO 的只读投影。`test-v4-source-runtime.mjs` 同时检查吸附视图拒绝外部/过期/预览句柄并复用不可变 frame；原组件浏览器 fixture 的 `/snap` 验证真实端点吸附、Alt 绕过、Shift 限轴、Esc 取消和一次撤销。证据包含 `snap-result.json`，不代表默认根工作区已接线。

`test-v4-object-gesture.mjs` 检查部件/组选区通过 pose 进行世界位移，涵盖旋转父组、父子去重、镜像结果随动、原始定义不变、基线预览/撤销和锁定/失效保护。Sandrone 原组件浏览器 fixture 同时区分部件位姿拖动与源路径几何拖动，防止将 pathIds 位移误当作对象变换。

`node scripts/tests/unit/test-v4-append-boundary.mjs` 使用内置 Sandrone 与镜像/阵列/Join fixture 验证高级部件追加独立轮廓后，原源、构造、曲线/区域身份及赋值保持，支持一次撤销，并拒绝开放线、重复消费、锁定和 ID 冲突。可追加一个只读 `.spl` 路径检查其他样例；不修改该文件。`test-v4-curve-operators.mjs` 另检查曲线汇总保留 Join 闭合并阻止重复身份。两者是命令/求值验收，不代表原根增量角色绘制完成。

`test-v4-region-drawing.mjs` 验证增量分区/挖孔首点保存未发布分支，编码重开可续画，完成复用同一分支并迁移赋值，撤销恢复未完成状态，旧目标变化则拒绝提交；`test-v4-region-drawing-copy.mjs` 验证两种 pending 分支的复制重映射与续画，及删除源路径后保留诊断而不发布结果。原整根界面的对应真实鼠标验收并入 `tests/browser/smoke/test-v4-original-studio.cjs`，写入其独立浏览器 origin 的 OPFS。

`test-v4-boundary-drawing.mjs` 验证高级部件新增普通轮廓的首点保存、编码重开续画、闭合追加与撤销，保留旧曲线/区域身份及赋值；`test-v4-boundary-drawing-copy.mjs` 验证未完成轮廓的复制重映射与独立闭合。原根浏览器测试继续覆盖分区、挖洞后追加普通轮廓、撤销重做和保存。

原根 `test-v4-original-studio.cjs` 进一步覆盖同部件两条开放源线的端点合并、撤销重做及删除恢复；`test-v4-source-runtime.mjs` 验证预览期间端点吸附查询固定使用提交基线，不接受过期展示句柄。

原根浏览器另覆盖控制柄拖动后的重新拟合确认/取消、保留节点和边身份、撤销/重做。`test-v4-path-intents.mjs` 验证拟合端点转换、反向边和过期结果拒绝；`test-v4-path-geometry-command.mjs` 验证共享/驱动保护与精确控制柄写入。

`test-v4-fitted-path-intent.mjs` 验证原批量拟合曲线的规范写入、两段曲线闭合、不可变候选、过期拒绝、保存重开与一次撤销；原根浏览器通过公开 create_path 生成候选，再点击原接受/丢弃按钮，并检查直接创建返回的路径 id 与规范保存。

`test-v4-creation-output.mjs` 验证原输出运行时的规范实体/3MF、复用、只读及预览/过期拒绝；`test-v4-body-samples.mjs` 默认检查内置 Sandrone，可用额外路径参数检查其他本地样例，验证实体、STL、材料体积和 3MF。原根浏览器使用 browser-studio-host 和真实 document-worker/WASM，覆盖内置样例的成品检查与通用 3MF 内容。

原根浏览器验收还覆盖公开 finish_path 与 Enter 的同一分区提交语义、单步撤销重做，以及未完成孔的错误返回、原始线条保留与保存后续画。

原根浏览器的工程副本检查对 API 与原导出按钮实际下载的 .spl 分别解码，核对当前规范 Sandrone 文档和底图资源；test-v4-studio-session.mjs 同时验证导出不写文件、不清除 dirty、返回字节独立，以及预览和关闭期间拒绝导出。

原根浏览器还在源曲线导出窗口修改 Blender 挤出厚度，解析实际导出脚本核对值，并确认规范文档、底图资源和工程副本不变；会话单测覆盖偏好与几何撤销分离、非法值/预览/关闭拒绝。

新增 test-v4-agent-project-input.mjs 验证旧 API 工程对象与 V4 base64 进入同一迁移/资源解码管线，拒绝双输入、无效容器及裸 V4 JSON。原根浏览器覆盖 API 导出回读、无效输入保持、V4/旧导入后的继续绘制和撤销，并检查连续导入各自返回路径数。

原 node-actions 对照测试和原根浏览器覆盖 set_point：前者比较部件 pose 下普通/平滑/对称模式与旧控制柄行为，后者通过公开 API 移动两侧控制柄并回读准确坐标、一次撤销恢复文档。

原节点动作对照与原根浏览器还覆盖双击精确拆分：验证原曲线/模式保持、稳定 Edge 命令、非法和过期操作拒绝，以及 Sandrone 真实双击后单步撤销恢复规范文档。

新增 test-v4-group-intents.mjs 覆盖原源线编组/排序到规范集合命令的原子适配、旧移动顺序对照、重叠展示与失效拒绝；test-v4-source-organization.mjs 增加显式移入/移出及混合集合保护。原根浏览器覆盖 Ctrl+G、撤销重做、组 API 的成员/显隐/重命名/解散、排序和保存重开。

`test-v4-source-scale.mjs` 验证源空间标定保持构造参数的物理毫米含义，包含嵌套 pose、关系驱动点/柄、参考图仿射、文件往返与原子撤销；不代替原宽度控件及显示坐标框持久化验收。
