# 原修改器组件接线验证

日期：2026-09-20。范围：原组件接入 V4 参数及旧工作区行为回归；不是默认 V4 工作区或原生文件签收。

原 `CreationModifiers` 现在直接读取 `modifierStatus.controls`，沿用原卡片、数值输入和 CSS。构造图使用明确的 `modifierModel` 标记，不伪造旧列表、来源或作用范围。驱动值只读；缺失参数不显示默认角度或零坐标；锁定部件禁止提交。新增、删除、排序、来源和作用范围的 V4 接线仍未完成。

`node scripts/tests/browser/smoke/test-v4-original-modifier-controls.cjs` 在临时端口和全新 context 中挂载真实原组件、原样式与真实 V4 会话。实际输入 120° 后正确写入旋转部件的局部角度，原 Sketch 不变，一次撤销恢复完整 Document；启用切换、参数驱动、缺失参数和锁定均通过。测试还断言原卡片圆角和布局样式。证据：`output/playwright/v4-original-modifier-controls/result.json` 与同目录截图。此 fixture 不访问应用草稿或用户文件。

旧修改器用例曾假设 Sandrone 文件的初始作用范围为全部，实际上文件保存的是选定区域，并可能抢先读取启动工程。本次让测试等待实际文件中的修改器内容，再明确建立全部区域的撤销起点。相交运算改变拓扑时，按已有输出契约检查暂停、可见诊断及恢复原运算后的修复，不再访问不存在的旧区域。拖放测试使用足够高的 viewport 并收起参数，防止面板滚动令自动化拖起另一张卡片；原产品拖放实现没有修改。草稿状态断言同步当前文案。

以下两项均通过，每项 16 个行为断言：

```sh
pnpm test:browser --suite legacy --case modifiers --target desktop-frontend --port 4197 --output outputs/v4-qa/original-modifier-legacy-tall-2026-09-20
pnpm test:browser --suite legacy --case modifiers --target web --port 4198 --inspector-port 9258 --output outputs/v4-qa/original-modifier-legacy-web-2026-09-20
```

覆盖实际 Sandrone 的范围、撤销、启停、重命名、拓扑暂停/修复、数值取消、拖动及菜单排序、删除、嵌套构造、草稿刷新恢复和源曲线不变。两项仍运行原后端，不能据此声称 V4 全流程完成。

`pnpm check:all` 退出码 0，89 项 hermetic 单元测试、类型、lint、格式、Rust 格式与编译及双端构建通过；日志为 `outputs/v4-qa/check-all-original-modifier-dom-2026-09-20.log`。随后调整阶段提示文字及浏览器测试，重新执行双端构建、组件浏览器验证、全库 lint/格式及上述双端旧流程验证。CommonJS 浏览器脚本的 lint override 处理 Node 模块函数解构误报；产品规则不变，Worker 单测明确等待 terminate。

默认根入口仍使用原 UI 的旧后端。完整 goal 保持进行中。

## 同日补充：原画布节点与控制柄

默认 Studio 仍使用原手势状态机；仅把路径和节点/柄 SVG 提取为纯渲染组件，保留原 CSS、data 属性、选中外观及事件目标。V4 点手势将命中索引解析为已展示源的稳定身份，像素位移始终相对 pointer-down 基线，接入现有源预览与单一历史；没有反向导入展示曲线。

专项单测覆盖多选、点击未选节点、闭合接缝、旋转部件、模式联动、非法命中、锁定/隐藏和旧工程手势失效。浏览器在内置 Sandrone 的同一原 SVG 组件上使用真实鼠标：节点移动在松开前只改变展示，松开后一次提交，撤销完全还原；控制柄拖动 Esc 还原且不增加 revision；不足 4px 不移动几何，Shift 只移动主轴，捕获丢失取消。之后继续进行原节点面板与 V4 文件副本保存重开。

当前 hook 不承担吸附、整路径移动、框选和端点续画，默认根也尚未切换至该 hook；这些仍是完整验收前的工作。

`pnpm check:all` 退出码 0：98 项 hermetic 单测、类型、lint、格式、Rust 和双端构建通过，日志 `outputs/v4-qa/check-all-original-canvas-2026-09-20.log`。补充的 pointer-up 主键保护及真实鼠标用例随后通过专项 lint/格式与浏览器验证。默认原工作区的 `spline-endpoints` 在双端通过，证据为 `outputs/v4-qa/original-canvas-desktop-2026-09-20/manifest.json` 与 `outputs/v4-qa/original-canvas-web-2026-09-20/manifest.json`。

首次并发跑 `agent-spline-authoring` 暴露其文件选择后立即读取的旧时序问题：Sandrone 尚未加载完成时找不到杯子部件。测试现在从同一 fixture 解码期望路径/部件 ID，等完整工程就绪后再继续；原断言保持不变。修正后桌面前端通过，证据 `outputs/v4-qa/original-canvas-agent-ready-2026-09-20/manifest.json`；失败记录保留在 `original-canvas-agent-2026-09-20`。这些完整工作区回归仍使用旧后端，不能替代 V4 默认切换。

## 同日补充：参考图资源与真实浏览器文件副本

`studio-presentation.mjs` 从文档 Reference 和通过大小/hash 校验的 asset bytes 创建 Blob URL，以参考图原有仿射推导原画布 frame。无图必须给出 frame，多图必须明确选择，不能显示的仿射明确拒绝；显示 URL 不写入文档或保存容器。`studio-host.mjs` 管理会话和图片资源：成功替换后释放旧 URL，失败保留原展示并释放候选资源，关闭幂等。恢复完成前发生工程替换时，候选图片也不能覆盖新工程的资源。

`studio-file-writer.mjs` 只写已经选择的目标。Web 分支检查 readwrite 授权并复用 FileWriter 的串行、close/abort；桌面分支调用已有原子写入能力。测试用注入平台能力覆盖拒绝、顺序与失败后重试，不接触真实用户文件。

浏览器中的内置 Sandrone 验证实际解码 1254×1254 图片、76 条源路径，通过原 `SplineNodeInspector` 改节点连接方式后撤销恢复。随后在独立 context 的私有 OPFS 中使用真实 `FileSystemFileHandle` 保存 V4 副本并重开：文档等价、dirty=false、Web 绑定有效、原图片 URL 释放且新图片可解码。结果为 `output/playwright/v4-original-modifier-controls/reference-result.json`，已检查截图 `sandrone-reference-reopened.png`。这是实际资源、节点组件与浏览器文件能力验证；不是完整默认工作区或原生桌面验收，未修改内置 `.spl`。

`pnpm check:all` 退出码 0：97 项 hermetic 单测及类型、lint、格式、Rust 和双端前端构建通过，日志 `outputs/v4-qa/check-all-studio-host-2026-09-20.log`。内置样例 SHA-256 仍为 `0997DD9A6D41AE21DEF3E1555C0BE4286668A29F4273FA4E9758C188CC883A86`。

## 同日补充：根会话与文件状态

`createStudioSession` 建立原工作区待接入的根会话：唯一 EditorSession、持久化会话和源/构造运行时共同发出稳定订阅 snapshot。展示 Project 由原 Studio 投影生成并由运行时签发，包含真实源路径；既不存入历史，也不写入 `.spl`。打开新文件前验证文档、参考系及可克隆输入，替换时抑制中间订阅通知，只发布完整的新状态。旧运行时关闭，旧命令不能写进新文件。

持久化打开接受实际初始 revision 和 dirty，干净 V4 文件打开后保持干净，旧工程强制未绑定且待保存。相同身份的同步和取消预览不置脏，旧 revision 或同 revision 的不同文档拒绝。`open()` 在输入克隆或校验失败时保留之前的文件状态。根控制器保存捕获真实文档版本，预览不能保存；迟到的旧文件写入不重新绑定新文件。恢复进入未绑定的修改状态；等待参考系期间的编辑或同一预览 ID 的新采样会使恢复失效。

专项测试用真实 V4 codec 校验保存字节，覆盖源拖动、订阅、撤销、完整替换、文件绑定、恢复与竞态。原组件浏览器 fixture 使用 `useSyncExternalStore` 读取根控制器，保留原修改器、节点面板和预览，验证初始干净→修改置脏→保存干净，以及真实展示路径。平台 writer 在 fixture 中为内存收集器，不访问用户文件；这不是原生保存验收。默认根和参考图资源生命周期尚未切换。

`pnpm check:all` 退出码 0，95 项 hermetic 单测、类型、lint、格式、Rust 和双端前端构建通过；日志为 `outputs/v4-qa/check-all-studio-session-2026-09-20.log`。原组件浏览器回归通过，结果在原 fixture 输出目录。此轮未改原入口 UI，双端构建产物仍为原界面。

## 同日补充：原节点面板动作接线

原主界面的连接方式、指定段直连和批量删除节点使用统一的 `node-actions.mjs` 边界；公开 API 的连接方式也走同一入口，统一清除失效的拟合误差。旧后端继续用原样条算法及事务，V4 后端只从捕获的展示句柄解析稳定源身份并提交命令。原面板 DOM、样式、选区更新和状态提示未替换。

`test-v4-node-actions.mjs` 在旋转部件及非整数比例显示坐标下对比新旧后端的曲线与节点模式，检查单次撤销、过期控制器、非法索引不提交及最后一个节点删除。原组件浏览器用例挂载原 `SplineNodeInspector`，实际选择对称模式、点击前段直连和删除，再分别撤销回同一文档；派生预览随源改变，模式/直连不移动锚点。截图 `output/playwright/v4-original-modifier-controls/source-node-inspector.png` 已检查，保留原控件与样式；fixture 中绝对定位的预览工具条限制在自己的画布容器内，避免遮盖节点控件。

这一步尚未完成主画布拖动、续画或根文件会话的 V4 切换。根会话审阅发现，当前 V4 持久化 `open()` 的初始 revision 固定为 0，随后 `update()` 会把新打开的干净文档置脏；正式接入时须让打开管线直接对齐 EditorSession 身份与干净状态，并通过真实保存/重开验证，不能靠跳过一致性检查解决。

`pnpm check:all` 退出码 0：94 项 hermetic 单测、类型、lint、格式、Rust 检查和双端构建全部通过，日志 `outputs/v4-qa/check-all-original-node-actions-2026-09-20.log`。原工作区 `spline-endpoints` 浏览器用例在 Web 与桌面前端均通过，覆盖相邻段直连、节点连接方式、删除、续画及撤销；证据分别为 `outputs/v4-qa/original-node-actions-web-2026-09-20/manifest.json` 和 `outputs/v4-qa/original-node-actions-desktop-2026-09-20/manifest.json`。使用内置 Sandrone 的 `agent-spline-authoring` 在桌面前端通过：`outputs/v4-qa/original-node-agent-desktop-2026-09-20/manifest.json`。这些完整原工作区用例仍使用旧后端，V4 的本次浏览器覆盖限于原组件接线。

## 同日补充：源编辑与构造共享会话

`source-runtime.mjs` 通过 CreationRuntime 的私有句柄表接入同一 EditorSession。源点/柄命令与路径命令复用已有稳定身份编译器，不反向转换展示 Project；手势更新始终基于捕获的起始文档，取消无历史、提交一次撤销。源视图和派生曲线读取同一预览状态。相同几何的新采样也有独立预览版本，旧句柄不能继续被读取或绑定。

`test-v4-source-runtime.mjs` 验证像素坐标与源身份、冻结参考系、基线更新、实时镜像预览、源/路径/修改器交错编辑的同一撤销历史，以及 undo/replace 后失效手势不再修改数据。此处是运行时边界验证；没有替换原 UI，也没有将原主画布手势接线记为完成。

`pnpm check:all` 退出码 0：93 项 hermetic 单元测试、类型、lint、格式、Rust 格式/编译和双端前端构建通过。日志为 `outputs/v4-qa/check-all-shared-source-runtime-2026-09-20.log`。原修改器组件浏览器回归再次通过。

## 同日补充：纯曲线阶段新增

原添加表单在可用的纯曲线部件上开放镜像和阵列。命令追加到当前曲线发布端口，保持唯一源几何，按世界坐标中心及镜像角度转换；阵列角度保留相对步进。读取能力与命令分别检查锁定、求值状态和已有区域。已有区域时拒绝简化追加，避免只改曲线而未影响区域或隐式改写复杂构造。

`test-v4-modifier-add.mjs` 覆盖真实运行时中的连续镜像→阵列接线、输出变化、原源不变、逐次撤销、错误原子拒绝、父级锁定及可添加类型投影。原组件浏览器用例新增真实表单输入：三份阵列使曲线变为三倍，输入引用指向前序镜像，中心 `(17,32)` 转换到部件局部 `(2,3)`，一次撤销恢复完整 Document。

本次 `pnpm check:all` 退出码 0，90 项 hermetic 单元测试及所有类型、lint、格式、Rust、双端构建检查通过。日志：`outputs/v4-qa/check-all-original-modifier-add-2026-09-20.log`。原组件浏览器用例通过，结果仍在上文独立 fixture 目录。

闭合构面的旧 `joinMM` 焊接及失败处理与 V4 Fill 不等价，本次明确拒绝，不默认丢弃参数。已有区域的新增、删除排序及原画布派生样条预览仍未接线；后者当前仍调用旧曲线求值器，是后续默认根工作区接入的必要依赖。

## 同日补充：原派生样条预览

`useCurvePreview` 现可从同一 CreationRuntime 同步读取 V4 当前曲线结果；不等待区域 Worker，也不调用旧曲线求值器。投影沿用原预览的世界毫米/Y-up DTO、开关、阶段选择和 SVG overlay。最终视图只读取明确发布的曲线端口，不把字典末项或其他分支的构面输入当成最终输出；blocked、empty、absent 均不回退旧阶段。阶段键包含算子和端口，避免任意文档 ID 与保留的 `final` 冲突。

端点/分叉度数根据 Edge 的共享顶点键和明确 Join 端点集合计算，不按距离推断连接。祖先隐藏同样隐藏预览；投影深冻结，不回写源。运行时只接收自己发出的当前展示句柄；相同拖动 ID 下数据更新、取消和旧句柄拒绝均有专项测试，不产生新历史。

原组件浏览器用例实际验证 SVG：镜像 2 条→新增阵列 6 条→选择镜像阶段 2 条→最终 6 条；关闭显示没有路径，重新开启恢复；参数缺失后最终路径为空，不能用成功的中间阶段冒充。`test-v4-curve-preview.mjs` 和 `test-v4-curve-preview-runtime.mjs` 覆盖坐标、拓扑、多分支、真实 Fill 输入、隐藏和实时状态边界。

`pnpm check:all` 退出码 0，92 项 hermetic 单元测试及类型、lint、格式、Rust 和双端构建通过；日志为 `outputs/v4-qa/check-all-original-curve-preview-2026-09-20.log`。阶段键补充后专项单测、组件浏览器、全库 lint/格式亦通过。默认根尚未注入 V4 会话，真实源画布拖动、完整模型/文件旅程仍未签收。

## 原整线拖动和统一指针生命周期

`beginV4PathGesture` 把源路径选区转换为去重的稳定源节点批次，使用捕获基线计算每次位移。共享节点不重复移动，闭合接缝不生成新顶点；控制柄保持相对向量，部件 pose 不变。`useSourceDrag` 同时承接节点、控制柄和路径命中，共用 4px 门槛、Shift 限轴、Esc/失去捕获取消和单次提交。原默认根事件尚未改接。

`test-v4-point-gesture.mjs` 新增旋转部件、共享路径、开/闭合线、完整控制柄形状、取消、未知路径和一次撤销检查。原 Sandrone 浏览器 fixture 从真实 SVG 路径命中开始拖动，确认全部 cubic 点位移、预览不提交、松手一次提交、撤销恢复原文档。现有节点及控制柄鼠标检查仍通过。

原 `translatePaths` 的涂色和分区种子联动仍需迁入明确的命令边界；这里验证的是源几何移动，不能据此签收对象移动或默认工作区全流程。`pnpm check:all` 退出 0，98 项单测、类型/lint/格式、Rust 检查和双端前端生产构建通过。全量检查日志：`outputs/v4-qa/check-all-source-path-drag-2026-09-20.log`。

## 源移动与区域样式联动核验

`test-v4-path-move-equivalence.mjs` 对内置 Sandrone 的头发部件源线移动 12/-8 像素，以原 `translatePaths` 和 `evaluateCreation` 的结果对比：69 个区域保持几何误差小于 0.001 mm²，颜色、厚度一致。旧 hair-partition fixture 的空间样式查找在移动后本身报歧义，故使用移动前已验证的分区单元平移作为基准，覆盖全部相关源线与外部边界移动后的 11 组涂色，包括跨多个单元的涂色。V4 实时区域保持相同 output ref，按原色及厚度解算，且不改写 programs/contracts 或 nodes；一次撤销恢复原文档。

核验结论：导入时旧涂色几何及 split seed 已转为稳定引用绑定，V4 不需要额外补偿平移；上一节的待核验项据此解除。镜像/阵列中心和固定裁剪输入保持原参数语义；不能把“源线全选平移”当成最终结果的刚体平移。全图平移若改变与固定输入的拓扑关系，原实现也会阻断。默认根及原生文件仍需独立接线验收。

本批 `pnpm check:all` 退出 0：99 项单测、类型/lint/格式、Rust 检查及 Web/桌面前端构建通过。日志：`outputs/v4-qa/check-all-path-move-equivalence-2026-09-20.log`。

## 原画布端点吸附

`endpoint-snap-view.mjs` 从 V4 当前源身份、明确发布的曲线实例和已求值 affine 变换生成只读吸附 DTO。当前部件使用其真实镜像/阵列实例，其他部件保持原来的仅源端点目标；源顶点身份用于排除自身及共享该顶点的随动副本。显式连通性和同坐标端点的保守计数共同避免向已连接处吸附。固定集提供对称轴/旋转中心；轴上端点保留原接缝拖动约束，此辅助行为不创建持久 Join。失效发布分支不使用陈旧派生目标，源线仍可编辑。

CreationRuntime 只允许已提交、当前签发的 project 读取吸附目标，并复用冻结 frame。`useSourceDrag` 捕获一次目标后复用原 `snapEndpoint` 的屏幕距离与滞回规则；Alt 临时绕过，Shift 限轴时不吸附，取消和提交清理反馈。默认根事件尚未换接。

新增单测覆盖位姿后的镜像/阵列、共享源顶点、隐藏、独立部件源端点、显式 Join、同坐标防分叉、失效发布和不可变 DTO；原组件浏览器新增 `/snap`，通过原 SVG 节点实际鼠标验证吸附、Alt/Shift、Esc 和一次撤销。证据：`output/playwright/v4-original-modifier-controls/snap-result.json`。实际 Sandrone 源编辑/保存重开 fixture 同批回归，仍不代替默认根或原生文件验收。

本批 `pnpm check:all` 退出 0，100 项单测、类型/lint/格式、Rust 检查与双端构建通过。日志：`outputs/v4-qa/check-all-original-source-snap-2026-09-20.log`。全量检查启动后补强的“其他部件真实镜像仍只提供源端点”断言另行通过该单测与定向 lint/格式检查；产品实现未再改变。

## 部件位姿与源线移动分责

`CreationRuntime.beginObjectGesture(project, nodeIds)` 捕获当前部件/组选区，用冻结源画布 frame 的线性部分把像素位移转换成世界毫米位移，再通过 `move-nodes` 改场景 pose。`runtime-gesture.mjs` 统一源编辑与部件移动的 epoch/revision/preview 校验、基线预览、取消和单次提交；不引入第二套历史。父组和子节点同时选中时，场景变换只应用到选区根。

原 `CreationWorkspace.prepare_move` 现在同时保留 nodeIds，原默认根暂仍使用旧 pathIds 分支，不能据此声称对象移动已默认切换。`useSourceDrag.onObjectPointerDown` 复用现有指针门槛、限轴、取消和捕获处理。源线移动只改 Sketch；部件移动只改 nodes 的 pose，固定局部参数和镜像结果随场景一起移动。

`test-v4-object-gesture.mjs` 验证旋转组内的世界位移、父子选区去重、镜像派生曲线随位姿移动、所有非 nodes 定义不变、连续基线预览、取消、单次撤销、锁定和替换会话失效。Sandrone 原 SVG fixture 以真实鼠标移动部件，验证显示位移、一次提交、raw sketches/programs 不变和撤销恢复；同批节点/源路径/吸附/文件重开检查仍通过。

本批 `pnpm check:all` 退出 0：101 项单测、类型/lint/格式、Rust 检查及双端前端构建通过。日志：`outputs/v4-qa/check-all-object-pose-gesture-2026-09-20.log`。

## 完整原 Studio 的会话注入

`StudioApp({ host })` 保留原界面，通过 `useStudioProject` 订阅 V4 会话；未提供 host 时仍走原默认入口。原节点操作、节点/柄手势、吸附、按 nodeIds 的部件移动、撤销/重做和保存复用同一会话。原 Project setter/事务在 V4 分支拒绝未适配写入，防止把展示投影当作第二个可写工程。撤销同步清理原选区与临时绘制状态。

`test-v4-original-studio.cjs` 在临时端口、独立浏览器 context、真实 Worker 下挂载完整原 Studio，使用内置 Sandrone。真实鼠标节点拖动仅改变源几何；部件拖动仅改变节点位姿；两者各提交一次，分别撤销恢复基线。原保存按钮写入 OPFS 副本，读取文件字节验证为当前 V4 文档；76 条源路径、11 个部件不变，页面和控制台无错误。证据位于 `output/playwright/v4-original-studio/result.json` 与 `original-studio.png`。

此次真实界面测试发现并修复 `.view-controls` 同时继承 left 和 right 导致按钮留在左侧、被派生曲线控件遮挡的问题；原缩放控件恢复右侧定位。工程标题读取会话当前文件名。浏览器测试以正常点击验证适合画布按钮，无强制点击。

`pnpm check:all` 退出 0，101 项单测、格式、Rust 检查及双端构建通过，日志为 `outputs/v4-qa/check-all-original-studio-host-2026-09-20.log`。检查运行期间补充的标题/历史清理改动另行通过类型与定向 lint，最终产品已进入该次双端构建；新增浏览器文件另行通过格式/lint及真实执行。原组件修改器、Sandrone 源编辑/保存和吸附脚本仍通过。

这是原根接线的可运行阶段，不是默认切换：新建、打开、参考图修改、描绘、部分源树操作、ModelWorkspace 和完整 Agent API 写入仍须适配；原生文件旅程尚未签收。

无 host 的原默认入口另行通过 Web 和 desktop-frontend 的 `endpoint-snapping` 真实浏览器回归；证据分别为 `outputs/v4-qa/original-host-legacy-web-2026-09-20/manifest.json` 与 `outputs/v4-qa/original-host-legacy-desktop-2026-09-20/manifest.json`。

## 原文件打开与示例菜单

原 `loadProjectFile` 的 V4 分支识别文件后直接调用 `host.open`，不经旧 `load_project` Project 事务。成功打开后清理选区、绘制/重拟合候选，清空会话历史并换参考图；无参考图的文档沿用当前显示坐标框架。解析或资源验证失败时不清理当前文档。保存/手势进行中拒绝替换。桌面原生打开事件通过 Effect Event 调用同一最新入口，浏览器选择器及文件 input 也共用此入口。

扩展的完整原根浏览器测试通过原菜单读取实际 OPFS 文件：从有未保存位姿编辑的工程重开已保存 V4，恢复基线并保留 web 绑定，撤销历史清空；再开损坏字节，完整证据快照保持不变；打开旧版 Sandrone 得到同等 76 路径/11 部件，但 dirty 为 true、target 为 null。原“载入示例工程”菜单也通过，同样不绑定静态示例文件。页面及控制台无错误。证据仍在 `output/playwright/v4-original-studio/result.json`，新增 `reopened` / `legacyOpened` 字段。

`pnpm check:all` 退出 0，101 项单测、类型/lint/格式、Rust 检查和双端构建通过：`outputs/v4-qa/check-all-original-file-open-2026-09-20.log`。之后补充示例菜单浏览器断言并通过定向 lint/格式与完整浏览器执行。文件 codec 已被打开入口静态依赖，最终将无效动态导入统一为静态导入并复查类型/lint和双端构建，日志 `outputs/v4-qa/build-original-file-open-final-2026-09-20.log`。

此次系统文件选择器以返回隔离 OPFS 句柄的端口代替；真实读取、格式识别、会话替换和菜单行为来自产品代码，不构成操作系统原生对话框/磁盘或默认入口切换签收。

## 从图片新建 V4 工程

原图片 input/拖放共用的 `importImage` 保留原格式、30 MB 限制、解码与 4096 像素缩小处理。V4 分支直接通过 `createReferenceProject` 构建空文档、独立图片资源及居中毫米参考变换；默认宽 100 mm、厚度 2 mm 与原界面一致。读取过程中已有工程修改或切换时拒绝迟到结果；新建成功后不保留旧选区、临时绘制、文件绑定及历史。

新增单测覆盖空模型、资源字节不共享、坐标映射、非法输入及真实 PNG 的 V4 编码/解码往返。完整原根浏览器测试实际上传 `public/reference.png`，验证 0 路径/0 部件、未保存/无绑定/无撤销、Worker 完成分析，再通过原保存按钮写入单独 OPFS 目标并读取校验当前 V4 文档；无页面或控制台错误。证据 `output/playwright/v4-original-studio/result.json` 的 `newImage` 和最终 `evidence`，截图 `original-studio.png`。

`pnpm check:all` 退出 0，102 项单测、类型/lint/格式、Rust 检查和双端构建通过，日志 `outputs/v4-qa/check-all-original-new-image-2026-09-20.log`。全量检查期间补充的新图保存浏览器断言另行通过定向 lint/格式与完整浏览器执行；产品实现未再改变。描绘、建模、参考图编辑及完整 API 接线仍待完成，默认入口仍未切换。

## 普通轮廓描绘与候选区域

原根的 `addAnchor` / `closePath` 在 V4 模式下通过捕获的 runtime/project 发送路径意图，拟合前后不创建可写 Project 镜像。CreationWorkspace 的只读 `trace_target` 提供所属部件与待绘制语义；普通 source/fill 部件沿用基本路径命令。分区/挖洞及已有高级构造的追加仍显式拒绝，避免通过普通绘制替换构造图。

完整原根浏览器脚本在新图片工程上实际按 Alt 落三点，得到一条两段开放线和一个部件；切到原手动模式后按 C，得到三段闭合线与一个候选区域。一次撤销恢复开放两段，重做恢复闭合；切换原选择工具并点击候选区域，属性栏确认单区域选择；原保存按钮写出的 V4 文档与当前状态一致。证据为 `output/playwright/v4-original-studio/result.json` 的 `drawing` / `closed` / `evidence`，以及同目录截图。

这条完整操作链路发现并修复两处兼容缺口：未赋厚度的 V4 候选区域不应因 enabled=false 被画布过滤，过滤现在只针对已赋值且禁用的区域；未上色区域和空色卡的 null 颜色不应使原颜色面板崩溃，面板明确显示“未上色”，混合选区仍显示“多种颜色”。没有为新区域凭空写入颜色或厚度。

原 Alt 修饰键会屏蔽字母快捷键，测试先释放 Alt 再操作 C；保留原键盘约定。当前浏览器验证的是手动描绘链路，不据此声称全部自动拟合、续画方向、角色绘制和高级构造旅程均已签收。

最终 `pnpm check:all` 退出 0，102 项单测、类型/lint/格式、Rust 检查和双端构建通过，日志 `outputs/v4-qa/check-all-original-trace-candidates-2026-09-20.log`。完整原根浏览器复测通过，包含候选区域实际点击及描绘结果保存；页面和控制台无错误。

无 host 的默认桌面前端另行通过 `selection-scope` 回归，覆盖原选区属性、颜色草稿切换和实体导出流程；证据 `outputs/v4-qa/original-trace-selection-2026-09-20/manifest.json`。

## 2026-09-20 高级部件追加轮廓的命令基础

`append-boundary` 接已有未消费的闭合 PathRef，保留旧程序，通过独立 Source/Fill 与区域、曲线汇总发布新增结果。curve-collect 保留原曲线、实例和 Join 身份，拒绝重复身份；默认修改器列表隐藏结构性汇总。区域命令与追加命令共用防冲突 ID 分配器，防止覆盖旧算子。

`node scripts/tests/unit/test-v4-append-boundary.mjs output/agent-emblem/sandrone-gold-emblem.spl` 通过内置 Sandrone、金色徽章和重复纹样 fixture；检查旧区域/曲线身份与几何、原始源、算子、外观/浮雕/制造赋值、一次撤销/重做，以及开放线、重复消费、锁定、ID 冲突拒绝。局部坐标 identity 计算允许 IEEE -0 与 +0 等价，其余定义与身份精确比较。原根角色绘制尚未接入该命令。

类型、lint 和全部 103 项单测通过，日志 `outputs/v4-qa/check-all-append-boundary-2026-09-20.log`。该次全量命令随后因补充测试断言时的格式检查未通过而停止；格式修正及该测试复跑通过，接续的全库格式、Rust 格式/检查、Web/Desktop 构建均退出 0，日志 `outputs/v4-qa/check-append-boundary-remaining-2026-09-20.log`。没有将该命令基础作为新增浏览器或默认入口旅程签收。

## 2026-09-20 原界面增量分区与挖孔

未完成绘制以真实未发布分支和终端 `authoring:{phase:'drawing'}` 保存。分区/挖孔命令共用准备和完成两步，完成保留已有分支身份、校验捕获的端口与准确目标并迁移赋值。首点、开放孔和未切开的分区线不能完成；失败保留此前的源线。保存重开、两种分支的 owner 复制后续画、源删除保留诊断、旧目标失效拒绝、一次撤销均有单测覆盖。默认修改器不会显示或误启用 pending 分支，原源线角色由实际输入链推导。

原 Studio 在选择“画分区线”或“画挖洞轮廓”时先捕获目标，再清空临时选区开始画线；否则第一次落点会因选区已清空而误建普通部件。Enter/Esc、右键结束和原描绘结束按钮使用统一完成命令。原数值控件对尚无值的字段显示“未设置”，不写入推测的默认值。活动端点提示不再用透明命中框挡住邻近落点，非活动端点的续画/闭合操作保留。

`pnpm check:all` 退出 0，包含全部 105 项单测、类型/lint/格式、Rust 格式/检查与双端构建，日志 `outputs/v4-qa/check-all-region-drawing-2026-09-20.log`。端点命中修复后重新执行类型/lint/格式与双端构建，退出 0，日志 `outputs/v4-qa/check-region-endpoint-ui-2026-09-20.log`。原根浏览器的分区、撤销/重做和闭合挖孔先行通过，后续补充保存重开续画的结果见下文；默认入口切换、目标修复与全部用户旅程仍未签收。

真实保存重开暴露了分区契约比较错误：原实现直接对成员对象 JSON.stringify，编码器排序字段后同一契约被误判改变。修复改为按明确字段比较成员集合，保留原区域 key；`test-v4-region-drawing.mjs` 增加已完成分区/孔的实际编码重开后求值等值断言。修复后全量检查再次退出 0，最终日志 `outputs/v4-qa/check-all-region-drawing-final-2026-09-20.log`。对两份实际 Sandrone 执行导入 → V4 编码/解码 → 平面求值的只读检查，69/70 个区域的发布状态、引用、几何、诊断和依赖集合保持一致；依赖集合比较不要求枚举顺序相同，日志 `outputs/v4-qa/sandrone-region-file-roundtrip-2026-09-20.log`。

最终完整原根浏览器验收退出 0：从原工具建立闭合轮廓、画分区线并结束，撤销/重做；开始孔的第一点后用原保存/打开菜单重开，在原树选择该线、从尾续画并闭合，确认两个区域完成异步刷新且部件无“需检查”提示，再保存与规范文档精确对比。`output/playwright/v4-original-studio/result.json` 的 `pendingSaved` 为 1 条待完成分支，`cutHole` 为 0，最终 3 条源线；页面和控制台错误均为空。截图保留原布局和样式。命令日志 `outputs/v4-qa/original-region-drawing-browser-2026-09-20.log`；此次仍使用显式注入 host 的隔离 fixture，默认根与原生验收未据此签收。

## 2026-09-20 高级部件追加轮廓的原界面接线

普通画轮廓在复杂 Program 内建立未发布 Source → Fill 分支，首点即可保存，闭合后复用追加命令发布。原有分区、孔、镜像、阵列与 Join 不被重写；角色从真实链路推导，默认界面不增加构造节点。合同更新至 v1.3。

`node scripts/tests/unit/test-v4-boundary-drawing.mjs output/agent-emblem/sandrone-gold-emblem.spl` 退出 0，覆盖两份真实样例与重复纹样的保存续画、旧定义与输出身份保持、完成后的文件往返、撤销/重做。新增 copy 测试验证整个高级部件复制后未完成 Fill 的引用重映射与独立闭合。

`node scripts/tests/browser/smoke/test-v4-original-studio.cjs` 退出 0。原工具完成分区、保存重开孔并续画后，再使用“画轮廓”追加独立闭合轮廓；结果为 4 条源线、3 个区域，撤销/重做和规范保存通过，页面与控制台错误为空。证据为 `output/playwright/v4-original-studio/result.json` 的 appendedBoundary 与最终 evidence；截图 original-studio.png 已人工检查，保持原布局及样式。仍为原 StudioApp 注入 V4 host 的隔离 fixture，不签收默认根或原生窗口。

本模块最终 `pnpm check:all` 退出 0：107 项单测、类型/lint/格式、Rust 格式/检查和 Web/Desktop 构建通过，日志 `outputs/v4-qa/check-all-boundary-drawing-2026-09-20.log`。首次运行因新增测试的 sort 缺少显式比较函数停止，修正后完整重跑通过。

## 2026-09-20 原源线合并、删除与端点辅助线

原根隐藏/显示、删除源路径和端点合并已接捕获源视图的 V4 命令；公开单节点删除入口复用既有节点适配器。合并继续使用原节点选择、M 快捷键和蓝色端点，无新增面板；同部件不同 Sketch 的来源转移和合并作为一次事务提交。

实际浏览器发现原端点辅助线仍进入旧 creationDocument，缺少旧 featureIds 导致渲染异常；改用 V4 运行时后又发现拖动预览不能使用仅接受已提交视图的查询。最终查询严格验证当前展示身份，但预览期间固定读取提交文档与不可变 frame；按 epoch/revision/路径/端点复用结果，避免随着移动副本改变目标或每帧重复求值。运行时单测覆盖首次在预览中查询、固定基线、外部/过期句柄拒绝及不可变 frame。

原根浏览器完整通过原有 Sandrone 编辑/保存/重开和轮廓/分区/孔操作后，使用原工具在同一部件画两条开放线，选尾节点按 M，再点击另一条的起点，得到一条三段曲线；撤销恢复两条，重做恢复合并。从原“路径操作”删除该线，撤销恢复。页面和控制台错误均为空。初步修复日志 `outputs/v4-qa/original-source-actions-final-2026-09-20.log` 退出 0；最终缓存版本与全量结果在下文补记。默认入口、原生文件及完整用户旅程仍未签收。

最终缓存版本原根浏览器退出 0，日志 `outputs/v4-qa/original-source-actions-cached-2026-09-20.log`；`output/playwright/v4-original-studio/result.json` 的 mergedPaths 为 1 条源线/3 段曲线，最终 evidence 为删除撤销后的恢复状态。`pnpm check:all` 退出 0，107 项单测、Rust 格式/检查及 Web/Desktop 构建通过，日志 `outputs/v4-qa/check-all-source-actions-final-2026-09-20.log`。查询缓存补充后类型/lint/全库格式和 source-runtime 单测另行通过；预览首次查询的补充断言通过。该次完整构建已包含缓存实现。

## 2026-09-20 原确认弹窗与重新拟合

V4 的原重新拟合入口从捕获的只读源视图按现有边逐段拟合，提交 refit-path 修改控制柄；保留节点/边身份及 Program，不用旧 TracePath 替换规范源数据，也不按像素距离过滤短边。用户确认、取消、忙碌提示及旧后端行为保留。异步写回受捕获视图版本保护，关系驱动/共享边使用命令既有拒绝逻辑。

首次真实弹窗测试发现隔离 Vite 配置没有正式 Web/Desktop 的 Tailwind PostCSS 处理器。弹窗透明拦截层因此挡住未正确定位的内容。这是测试环境不完整，不据此修改产品弹窗或添加覆盖样式。原根 fixture 已接入与产品相同的 Tailwind 插件；此前截图仅证明手写 CSS 的部分表现，不能独立作为全部 utility 样式保真的签收证据，以修正后的真实浏览器重跑为准。

`pnpm check:all` 退出 0，包含 107 项单测、类型/lint/格式、Rust 格式/检查及双端构建；日志 `outputs/v4-qa/check-all-refit-2026-09-20.log`。首次检查因捕获 Project 的回调类型推断错误停止，补上明确 Project 类型后完整重跑通过。测试环境修正后 lint 与全库格式另行通过。

修正样式管线后，`node scripts/tests/browser/smoke/test-v4-original-studio.cjs` 退出 0，日志 `outputs/v4-qa/original-refit-styled-2026-09-20.log`。先实际拖动控制柄，再打开原重新拟合弹窗；取消后规范文档不变，确认后源控制柄改变而 Vertex、Edge IDs 和 Program 不变，撤销恢复确认前完整文档，重做恢复拟合后完整文档。前面的 Sandrone 编辑、文件、区域绘制及源合并删除流程同时通过；页面与控制台错误为空。最终截图使用正式 Tailwind 管线。仍为注入 host 的隔离原根，不签收默认入口与原生文件。

## 2026-09-20 原候选路径与公开批量描绘

原 create_path 捕获拟合前工程视图，完成后编译 draw-path 意图；原接受按钮和 commit_preview 提交同一计划，不将临时 TracePath 导入或持久化。生成/丢弃候选不写工程，过期视图拒绝写回；临时候选 id 与实际提交路径 id 明确区分。规范命令支持两段曲线组成的闭合路径，保留拟合控制柄和端点拓扑，不将短曲线简化成折线。

新增 fitted-path-intent 单测通过：不可变拟合输入、闭合曲线、保存重开、一次撤销/重做、失效计划拒绝、不连续曲线原子失败和开放曲线精确保持。原根浏览器 `outputs/v4-qa/original-candidates-2026-09-20.log` 退出 0，使用公开 create_path 生成候选并点击原丢弃/接受按钮；规范文档确认生成/丢弃不变，接受后撤销/重做精确恢复，撤销清理旧候选，直接创建返回实际源路径 ID，最终规范保存匹配。页面及控制台错误为空。该测试继续使用正式 Tailwind 处理器并覆盖此前 Sandrone、分区/孔、合并、重新拟合流程；默认入口和全部 API 仍待完成。

最终 `pnpm check:all` 退出 0，108 项单测、类型/lint/格式、Rust 格式/检查与 Web/Desktop 构建通过，日志 `outputs/v4-qa/check-all-candidates-2026-09-20.log`。补充断言验证两段拟合曲线生成一个 ready 区域，局部单测通过。

## 2026-09-20 原成品检查、3MF 与浏览器 Worker

原输出面板的零件和模板由 V4 制造定义投影；solid/3mf 通过提交版本 BodySet 生成原面板 DTO，检查与导出复用该版本实体结果，禁止预览输出、失效句柄和异步迟到结果。browser-studio-host 装配现有 document-worker/WASM，释放时关闭客户端和 Worker。必须显式导入 worker-client.ts：省略扩展名时 Vite 会命中同目录旧 mjs 客户端，协议不匹配导致请求一直等待。该错误已通过真实浏览器定位，未把等待当作成功。

真实 Sandrone 暴露网格序列化错误：按坐标焊接丢失 Manifold 顶点身份，造成 1 条异常边。V4 改用显式 mergeFromVert/mergeToVert 合并拓扑，再按已有浮点精度修复流程重检；保持检查严格，不删除检查条件。内置样例与金色徽章的只读实体/STL/3MF 检查通过，分别 19420/20412 个三角面、69/70 份材料区域；均一个连通实体、0 异常边、0 零面积面，材料体积与整体守恒，文档不变。日志 `outputs/v4-qa/body-samples-2026-09-20.log`。

运行时测试覆盖体积、合法 3MF、结果复用、文档只读、未知零件/外来模板拒绝、预览拒绝和迟到拒绝。最终 `pnpm check:all` 退出 0，110 项单测、类型/lint/格式、Rust 格式/检查与双端构建通过，日志 `outputs/v4-qa/check-all-body-output-final-2026-09-20.log`。原高级 ModelWorkspace 完整写入、默认入口与原生窗口仍待签收，不能由这条输出管线替代。

最终真实浏览器退出 0，日志 `outputs/v4-qa/original-body-output-ready-2026-09-20.log`。检查内置 Sandrone BodySet 报告有效且体积为正，通用 3MF 经 base64 解码、ZIP 读取后包含三角网格；操作保持已保存状态。随后全套原界面编辑/文件/区域/拟合/候选流程通过，页面与控制台错误为空，结果文件记录 solidReport 与 generic3mfBytes。Worker 异步刷新暴露分区/挖洞按钮过早可点，已在区域更新期间禁用这两个依赖区域结果的入口，原逻辑与样式保留。最终 UI 修复后类型/lint/全库格式和双端构建另行通过，构建日志 `outputs/v4-qa/build-body-output-ready-2026-09-20.log`。

## 2026-09-20 完成绘制 API 与原交互对齐

原 finish_path 曾只清理绘制会话，未提交待完成分区却返回 finished。现在复用 finishDrawing：有效分区一次提交，构造失败返回原因并保留原线，忙碌/拖动/保存期间拒绝。原界面浏览器新增 Enter 完成后撤销，再通过 resume_path/finish_path 完成并撤销重做；单点孔结束失败不改变 revision，随后保存重开、续画闭合通过。

验证：outputs/v4-qa/original-finish-api-2026-09-20.log 为 PASS，包含真实 Sandrone Worker 实体检查及原界面流程；outputs/v4-qa/check-all-finish-api-2026-09-20.log 记录 pnpm check:all 退出 0，覆盖类型、lint、全部单元测试、格式、Rust 检查和 Web/桌面前端生产构建。完整 API 和默认入口仍未签收。

## 2026-09-20 原工程副本导出

原导出按钮曾调用旧 Project 编码器，export(json) 则直接序列化展示数据。现在两者都从 V4 会话取得含资源的规范 .spl 副本，副本不改变保存绑定、dirty 或历史；单元检查预览拒绝、返回字节无权威别名、关闭后拒绝。API 的 V4 返回结构为 filename/mimeType/base64。

outputs/v4-qa/original-project-copy-2026-09-20.log 为 PASS：原浏览器对真实 Sandrone 的 API 副本与按钮下载分别 decodeDocument，核对当前规范文档、底图资产与两份完整结果相等，再继续原编辑/撤销/保存/重开流程。完整 API 与默认切换仍未签收。

全库验证：outputs/v4-qa/check-all-project-copy-2026-09-20.log 记录 pnpm check:all 退出 0，覆盖类型、lint、全部单元测试、格式、Rust 检查和 Web/桌面前端生产构建。

## 2026-09-20 Blender 源曲线挤出偏好

原 V4 展示将 Blender 源曲线导出用的 depthMM 误称为新建浮雕默认值，输入又调用旧事务。现统一内部命名 blenderExtrusionMM，由会话 setBlenderExtrusion 刷新展示，文档/资源/历史/文件状态不变，runtime 保持同一实例；非法值、预览及关闭状态拒绝。单元验证改值后撤销几何仍保留偏好，导出规范文档不含此值。

outputs/v4-qa/original-export-preference-2026-09-20.log 为 PASS：原导出对话框输入 7.5，解析 Blender Python 中的 DATA 核对 depthMM；比较完整 Sandrone 工程证据不变，实际下载工程副本与输入前 API 副本解码结果一致，后续原编辑/保存流程继续通过。

全库验证：outputs/v4-qa/check-all-export-preference-2026-09-20.log 记录 pnpm check:all 退出 0，包含类型、lint、全部单元测试、格式、Rust 检查以及 Web/桌面前端生产构建。

## 2026-09-20 原 load_project API 接入文件管线

API 的旧 project 对象和完整容器 base64 现在共用原文件打开流程；输入互斥、文件资源经规范解码校验，旧工程通过正式迁移。无效输入保持当前工程；成功后清空历史和选区、解绑目标，旧导入标为 dirty。异步 API 返回对应打开快照的路径数，原旧文件与示例调用也等待 API 错误，不留未处理 Promise。

outputs/v4-qa/original-api-load-final-2026-09-20.log 为 PASS：V4 导出回读与文档完全一致，无效容器保持当前状态，V4/旧 Sandrone 导入后均可继续绘制和撤销；同一批次打开不同路径数的工程，各自返回正确路径数，最终当前工程为后一个。outputs/v4-qa/check-all-api-load-2026-09-20.log 记录 pnpm check:all 退出 0（111 个单元测试、类型、lint、格式、Rust 与双端生产构建）。完整 API、工程宽度和默认入口仍未签收。

## 2026-09-20 set_point 控制柄 API

原 set_point 的 legacy transact 已替换为 node-actions.moveHandle 适配器：V4 从捕获源视图解析有向控制柄身份，复用鼠标源命令与坐标变换；旧模式仍调用原 moveHandle。节点动作单测对照有旋转/平移 pose 的普通、smooth、symmetric 控制柄，检查另一侧联动、单次撤销、过期控制器和无效输入无写入。

outputs/v4-qa/original-api-handle-2026-09-20.log 为 PASS：原界面中通过 set_point 分别移动两侧柄，用 spline_inspect 回读精确像素位置，各自只增一次 revision，撤销恢复完整文档；其余原界面 Sandrone、文件、实体及导入流程继续通过。完整 API 与默认入口仍未签收。

验证收口：check-all-api-handle-2026-09-20.log 中类型、lint 与 111 项单元测试通过，格式步骤因同时更新本验收文档而失败。完成文档格式化后，单独重跑 format:check、desktop:format:check、desktop:check 均退出 0；build-api-handle-2026-09-20.log 记录双端生产构建退出 0。

## 2026-09-20 原画布双击精确拆分

原 splitAt 已由 legacy transact 改用共享节点动作：保留采样落点、选中新节点和状态提示，V4 解析当前源 Edge 身份并复用 split-span；旧精确拆分算法抽入 legacy adapter。单测覆盖有 pose 的曲线、平滑/对称模式与原结果一致、一次撤销、非法 t 与过期视图拒绝。浏览器增补内置 Sandrone 原 SVG 双击增加一段、一次 revision 和撤销恢复完整规范文档的检查。验证结果以 original-split-2026-09-20.log 与 check-all-original-split-2026-09-20.log 为准。

结果：原浏览器日志为 PASS；完整 pnpm check:all 退出 0，涵盖 111 项单元测试、类型、lint、格式、Rust 检查与双端生产构建。

## 2026-09-20 原源路径编组与排序

纯路径集合投影为原只读 groups，保留完整 pathIds/groupIds；唯一归属才给旧 groupId，混合实体集合不作路径分组。assign-path-collection 维护原显式移入的单分组行为，其他纯路径组移出选中成员、混合集合保持。原 Ctrl+G、按钮、manage_group 和 move_path(s) 经 group-intents 一次提交，排序仅写 Path.order。单元覆盖旧顺序对照、原子失败、重叠、锁定与一次撤销。原根浏览器新增编组/撤销重做、成员转移/显隐/命名/解散、排序及持久化验证；结果记录在 original-groups-2026-09-20.log 与 check-all-original-groups-2026-09-20.log。

结果：原浏览器日志为 PASS；完整 pnpm check:all 退出 0，涵盖 112 项单元测试、类型、lint、格式、Rust 检查与 Web/桌面前端生产构建。默认入口切换和完整 API 验收仍未完成。

## 2026-09-20 精确样条输入管线拆分

原 spline_apply 的输入解析已抽入独立 spline-proposal：冻结的 frame/paths/objects 视图可直接生成无新 ID 的精确曲线提案，原 writer 消费提案。单元覆盖矩阵和控制柄与原结果一致、无输入别名、整批失败以及新样条用途。没有更改原界面；V4 批量样条命令仍待完成。

outputs/v4-qa/check-all-spline-proposal-2026-09-20.log 记录 pnpm check:all 退出 0，涵盖 112 项单元测试、类型、lint、格式、Rust 检查和双端生产构建。

## 2026-09-20 精确源路径替换命令

replace-path-geometry 与捕获 path-intent 支持原像素坐标转世界/owner 局部坐标的精确替换。等拓扑保留反向使用及内部身份，变拓扑保留 Path/Program 并返回被移除的内部引用。共享、驱动、锁定、失效、ID 冲突及批量后续失败均保持原子性；开闭/节点数/单点继续编辑及一次撤销通过。原 spline_apply 整批接线尚未完成，本轮没有改原界面。

outputs/v4-qa/check-all-path-replacement-2026-09-20.log 记录 pnpm check:all 退出 0，覆盖 113 项单元测试、类型、lint、格式、Rust 与双端构建。随后补充关系消费者回归：关系定义保留，失效源经 resolveRelation 返回 blocked；受驱动 Handle 拒绝覆盖。补充测试及该文件 lint/格式检查通过。

## 2026-09-20 原 spline_apply 整批接线

原 API 的精确新建/替换/矩阵请求经只读提案编译为一次规范事务，返回本次命令产生的路径身份。辅助线隔离 Fill 成员；洞使用现有区域构造。单元验证闭合辅助线后再建边界不误填辅助线、洞、锁定中途失败整批回滚、过期捕获、跨所属拒绝和一次撤销。无变化提交不读取上一命令结果；仅名称操作不写几何，关系驱动曲线可改名。

original-spline-batch-final-2026-09-20.log 为 PASS：原界面真实 spline_apply 混合创建、准确控制柄回读、撤销/快捷键重做及规范副本保存回读通过，Sandrone/原样式及其他原编辑旅程继续通过。首轮测试错误调用不存在的 redo API，改为原重做快捷键后重跑成功。

check-all-spline-batch-2026-09-20.log 记录 pnpm check:all 退出 0，涵盖 114 项单元测试、类型、lint、格式、Rust 与双端构建。最后补充仅元数据分支及关系驱动改名测试后，相关单元、类型、全库 lint/格式与双端生产构建重新通过（build-spline-batch-final-2026-09-20.log）。默认入口、工程宽度及其余高级建模接线仍未签收。

## 2026-09-20 承托外形派生步骤

原承托按部件先合并区域再移除内部孔洞，不能逐分区独立去孔。新增 region-outline 规范算子，输入排序稳定，保留断开外形、源数据及单一结果身份，提供复制和坐标重定位钩子。单元检查单环孔洞、多个分区共同围孔、断开区域、输入不变、顺序不变、空/阻塞传播，并经注册的构造图验证源顶点改变后面积重新计算且结果引用不变。承托预备命令、厚度/叠放/打印层与原按钮确认仍未接完。

outputs/v4-qa/check-all-region-outline-2026-09-20.log 记录 pnpm check:all 退出 0，覆盖 115 项单元测试、类型、lint、格式、Rust 检查和 Web/桌面前端生产构建。
