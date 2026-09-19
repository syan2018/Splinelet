# P07 · 编辑器投影、画布与渐进属性

建档：2026-09-19。**这是一个分发工作包；T 编号是包内验收检查点，不要求为每个 T 新开执行任务。**

- 包负责人 / 验收者：未分配
- 建议角色：编辑体验负责人
- 执行状态：T15 纯投影模块已有证据；T16/T17 简化候选界面方向撤销，改为原工作区适配，尚未签收
- 起始提交 / 合同版本：分发时填写
- 总控：[范围、合同、最快可行调度与门槛](README.md)
- 设计依据：[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)
- 仓库约定：[AGENTS.md](../../AGENTS.md)

## 背景与要交付的改变

作品树和选择目前依赖 paths/cells；纯派生部件难移动，面失败容易丢选区，聚焦不能覆盖最终阵列。必须保留原工作区的 DOM 结构、样式、布局、工具与基本交互，让现有组件读取稳定 Node 与求值结果的任务投影。数据重构不授权重写一个简化编辑器。

### 原工作区接入顺序（2026-09-19 校正）

1. P00 负责 `studio-app.tsx` 的文件、会话、撤销边界；未完成原界面适配前，生产入口继续使用原工作区。不能通过 URL 参数替换整套界面。
2. P07 提供只读 UI 视图与稳定身份映射；保留 `CreationWorkspace` 的画布、作品树、属性导航和既有 CSS。只读投影不能成为另一份可保存、可写的旧 Project。
3. P06 补齐现有 `CreationWorkspace.run`、`ModelWorkspace.commit/mutate` 和源编辑手势所需的语义命令；P00 再逐项接线。禁止把编辑后的旧 Project 整体反向转换为 V4，禁止用每次重新导入替代稳定命令。
4. 首先覆盖实际 Sandrone 所用的边界/分区/挖洞/参考角色、布尔构造、逐区域颜色和厚度、分层、底图，以及 gold emblem 的镜像→阵列→构面；功能缺口必须显式记录，不能删掉旧按钮来通过测试。
5. 在同一原工作区中验证两份工程打开、选取、编辑、撤销、保存重开和预览。此前 `studio/v4` 简化组件与其浏览器用例只是试验材料，不作为交付前端或行为保持的证据。

### 当前接入合同

2026-09-19 拓扑操作增量：`delete-paths` 提供只读删除计划、共享边/顶点保留、下游算子影响和可修复引用；`straighten-edge` 保留原 `straightCubic` 的三分之一控制柄位置；`refit-path` 按捕获的有向边顺序更新自由柄，保留所有节点/边身份与端点。后两者对共享 Edge 或 Relation 柄冲突明确拒绝。`path-intents` 已完成像素视图、反向路径和迟到结果适配，也允许对暂时无法投影的路径执行名称修改或删除。

2026-09-20 节点与合并增量：`delete-path-vertices` 按稳定 Vertex ID 和捕获的有向边顺序删除，复用原节点删除的拟合与连续模式算法；存活节点/未受影响边保持身份，合并边分配新 ID，支持闭合起点旋转、单点与整条删除。`merge-paths` 保持原四种端点接合方向和三分之一直桥控制柄，保留第一条 Path 身份；重合端点焊接会检查共享与 Relation。原普通绘制产生的同部件不同 Sketch，通过保持世界坐标的来源转移与合并组合成一次撤销，拒绝扩大到其他共享路径或跨部件暗中转移。两者已有原像素视图和旧算法对照测试，API5 已登记；原画布事件、会话和保存接线仍未完成。验证范围见[本次快照](../../docs/qa/v4-node-deletion-and-merge-2026-09-20.md)。

2026-09-20 源列表增量：`Path.order` / `Collection.order` 显式保留显示顺序；旧 V4 缺省使用确定性 ID 次序，新线条追加，旧工程写入原路径/分组次序。源投影保留所有路径的稳定顺序及集合逐成员引用，不把重叠集合压成唯一 `groupId`。`create-path-collection`、`rename-collection`、`delete-collection` 与严格全量 `reorder-source-paths` 已有命令和像素视图意图适配；整理不会修改所有权、几何或构造输入。普通编组仍须按 Node 层级适配原工作区，不新增 Collection 管理入口。旧列表拖放的目标编组策略及父级事件接线尚未完成。

原 `studio-app.tsx` 的接线按以下行为切片推进，不新增工作包文档：

2026-09-20 实际来源复核发现并修复迁移中的隐藏分区接边 Path：接边改为动态求值，不再共享原可写 Edge 或保存一次性的派生延伸点。严格检查内置与 gold 的全部来源分别为 76/79 条路径、569/575 段原始曲线，并核对源显示顺序。端点/底面编辑及复制后的契约与属性回归见[本批快照](../../docs/qa/v4-source-organization-and-dynamic-partition-2026-09-20.md)。这仍是接入前模块验证，不签收 T16/T17。

1. 节点、柄、拆边：替换 `startPointDrag`/pointer move/up 与双击拆边；单次 Preview 提交，多节点拖动及批量模式切换须补原子命令。
2. 绘制、续画、闭合：补零边路径创建和 exact cubic append/prepend/close；保留每次落点可撤销与树中即时出现的行为。拟合在事务外，迟到结果用 epoch/revision 拒绝。
3. 删除、直连、合并：不能用 remove-edge 代替旧节点删除；保留重拟合与稳定路径身份。共享 Edge/Vertex 的拓扑影响须先查询，跨 owner 合并不能暗中转移来源。
4. 名称、可见性、分组、顺序：Path 元数据与 Collection 不等于 Shape 所有权。补原子批量命令，并明确未分组路径的持久显示顺序，不能依赖对象键次序。
5. 整路径重拟合：准备结果按稳定 Vertex/Edge 身份提交，保持确认对话框；一次撤销，校验原拓扑与会话版本，Relation 或共享源冲突显式处理。

源命令与只读类型/文件会话可独立推进；父级接线由 P00 串行集成。每个切片在原组件中验收，不能以新候选组件或删掉旧操作代替。

2026-09-19 增量：切片 1 的 `move-anchors`/`set-handle-modes` 已提供单事务批量适配，含共享 Vertex 去重、冲突拒绝、Preview 基准和整体失败回滚。切片 2 已有 exact cubic 头尾续画与拟合闭合；闭合和 Fill 成员更新一起撤销。首点通过 `start-path` 和零边 `Path.startVertexId` 持久保存，支持源视图选点、移动、单次撤销、容器往返与首次续画，Vertex 身份沿用；复制、转移与旧工程导入同步支持。切片 4 已有 `set-paths` 原子名称/显示命令；集合管理与显示顺序仍待补齐。`path-intents.mjs` 负责稳定展示 Path ID、像素拟合结果到 world mm 的转换和迟到拟合拒绝，不接受修改后的展示工程。上述命令仍待原画布事件和文件会话接线。

- `src/lib/editor/workspace-view.mjs` 的 `projectWorkspaceView(editorState, evaluated, frame)` 是统一读取边界；`evaluated` 必须携带 EvaluationSession 的 epoch/revision/previewId 和 snapshot，拒绝旧工程、旧 revision 或旧 preview 的结果。frame 显式提供旧画布使用的 width/height/widthMM。
- `source-view.mjs` 提供原源画布的精确像素 cubic 和 canonical EntityRef 反查；分段或反向不会让旧 identity 指向其他实体。局部坏路径只产生该路径诊断，不清空其他来源。
- `source-intents.mjs` 将已捕获源视图中的稳定锚点/柄/边身份编译成命令；处理像素→世界→所属部件局部坐标、反向边的拆分参数和 revision 保护。整次拖动使用同一基准视图与 Preview，只提交一次。已有模块测试，原画布事件尚未接入；绘制、续画、删除、连接及关系自由度编辑仍待适配。
- `studio-display.mjs` 把工作区投影、显式 Reference/asset URL/frame 与文件和默认厚度会话状态组成深冻结展示数据；不生成旧 ModelDocument 或旧历史。显式 reference:null 支持无底图，不伪造默认资产。有底图时只支持与原画布 frame 完全兼容的 Reference 仿射；任意仿射的原画布适配和展示类型替换仍未接线，不能用强制类型转换绕过。
- `creation-view.mjs` 提供原作品树、区域与属性的只读数据。路径 ID 与 source-view 一致；区域 key 包含完整 OutputRef。未计算的厚度/Z 不猜值，未启用打印层时不投影为分层模式。
- `creation-intents.mjs` 把原 `run(action,args)` 的 paint/height/clear_paint/swatch/delete_swatch/object/new_object 转为 V4 同一事务；批量上色及新建色卡只产生一次撤销，过期视图和预览视图不能提交正式命令。尚未适配的动作显式拒绝，不删按钮作为替代。
- `CreationWorkspace` 已支持可选 `CreationRuntime`：命令、求值、角色准备/确认、底板确认和模板更新有独立入口；未注入时保持原实现。没有修改 DOM/CSS。新建色卡与对象按前后 ID 差集定位，避免把数组排序当作身份。
- `src/lib/editor/creation-runtime.mjs` 从唯一 EditorSession 签发只读展示句柄；普通命令、预备事务、撤销和模板更新均写同一会话。异步求值拒绝过期状态，同一个拖动中的预览文档变化也会使旧展示失效；展示 Project 不接受反向解析或持久化。
- 这些模块已通过真实求值→只读视图→上色事务→重新求值的单元闭环，**父级 studio-app 尚未注入 V4 runtime**。当前 runtime 只支持已适配的创作命令和不带预览参数的 creation 求值；底板、实体/导出、角色及源路径接线仍需完成。双端默认 UI 复验只证明原行为保持，不能算为 V4 GUI 验收。

默认只有部件/组与按需线/区，直接上色和调厚度；高级构造随重复、引用等任务展开；修复失效保持原部件上下文。

2026-09-20 修改器参数适配：`modifier_update` 已支持现存算子的名称/启用、镜像角度与中心、曲线/区域阵列数量与角度/中心、外扩距离和布尔运算。`modifierStatus.controls` 提供同一源定义的只读控件值、可编辑字段和驱动/失效信息；中心以 world mm 显示和输入，镜像角度转换 owner 旋转，阵列角度保持相对步长。参数/表达式驱动值显示当前解算结果，普通数值写入不能解除绑定。运行时测试覆盖修改→重新求值→一次撤销及过期展示拒绝；原面板父级尚未注入该运行时，修改器来源/作用范围、接合设置、增加/排序/删除和完整构造列表展示仍未完成。

## 在整条管线中的位置

输入 P06 命令、P04/P05 snapshot 与有效属性；输出 props 明确的画布/树/属性组件和真实交互验收，P00 接入共享宿主。

T15 投影先完成；T16 画布和 T17 属性可并行且分目录写。共享选区只有一份，根组件由 P00 装配；普通任务不要求端口、坐标框架或手动 Fill。

所有包共同守护：部件身份不依赖输出类型/数量；源定义是唯一权威，求值结果只读；普通用户的默认概念只有部件、线条、区域、颜色和厚度，高级业务按需展开。技术正确与默认体验同时验收。

## 如何分发本包

先读本页背景、总控第 1–2 节及相关代码入口；开工前记录已验收的上游提交和合同版本。只启动依赖已就绪的检查点，不需等前一工作包全部做完，也不能跳过本检查点依赖。负责人可连续完成多个检查点，或在总控许可的非重叠范围内分给临时协作者。

- [T15 编辑器投影、拾取与语义选择](#t15)：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)
- [T16 默认画布与直接编辑接入](#t16)：[T01](01-validation-2026-09-19.md#t01)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T13 基础签收](06-editing-runtime-and-api-2026-09-19.md#t13)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)
- [T17 作品树、区域属性与按需构造详情](#t17)：[T01](01-validation-2026-09-19.md#t01)、[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T13 基础签收](06-editing-runtime-and-api-2026-09-19.md#t13)、[T15](07-editor-experience-2026-09-19.md#t15)

交付物先做覆盖面的最小验证，再交 P00 接线；同一待验收提交上的全量检查证据可以被多个检查点引用，不重复跑同一批构建。各检查点仍需自己的反例和语义验收。全部小项写完之前，下游可以使用已单独签收的检查点交付。

禁止修改未授权公共文件或其他执行者的工作；需扩范围时给出具体文件、理由、消费者影响，由 P00 登记后执行。

<a id="t15"></a>

## T15 · 编辑器投影、拾取与语义选择

- 状态：模块交付；真实发布结果、选择与世界 bounds 测试通过
- 执行者 / 验收者：未分配
- 前置：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)
- 下游：[T16](07-editor-experience-2026-09-19.md#t16)、[T17](07-editor-experience-2026-09-19.md#t17)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)
- 覆盖原工作包：R4/R5
- 验收复核：UI 负责人验证可消费性，主代理核对选择语义。

### 目标与代码背景

把文档身份和求值结果投影为简单的树、画布与属性，不让内部结果类型变成用户层级。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/hooks/use-creation-selection.ts](../../src/hooks/use-creation-selection.ts)
- [src/lib/creation-selection.mjs](../../src/lib/creation-selection.mjs)
- [src/lib/creation-pick.mjs](../../src/lib/creation-pick.mjs)
- [src/components/creation/creation-selection-details.tsx](../../src/components/creation/creation-selection-details.tsx)

### 可写范围

- src/lib/editor/projection.mjs（新增）
- src/lib/editor/selection.mjs（新增）
- src/lib/editor/picking.mjs（新增）
- src/hooks/use-editor-selection.ts（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. Node 身份/层级、源线、区域、诊断、有效颜色/厚度的只读视图；未上色候选只在画布点取，不默认重复列树。
2. Selection 使用 scope/entityRefs/activeRef；稳定区分部件、区域、线、节点及高级引用，不借 path 投影执行对象操作。
3. F 范围、世界命中、派生元素可写回能力与失效行定位共用当前 snapshot。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A09、A17、A18、A20；U01/U03/U06**；最终标准见架构方案第 10 节。

- [ ] 区域失败不删除所属部件；选区可停留在修复目标；异步更新不自动跳层或扩大到兄弟。
- [ ] V/A/P/H 的范围明确；Ctrl+A 服从当前语义范围；节点首版一条活动线。
- [ ] 折叠树/高级详情只改会话，Document 和几何 hash 不变。

验证命令：

```sh
node scripts/tests/unit/test-v4-editor-projection.mjs
```

上述 `test-v4-*.mjs` 是拟新增测试文件，交付后即可直接用 Node 运行，并由现有 `pnpm test` 自动枚举；Node 单测不等待浏览器 runner。只有列出的 `pnpm test:browser` 命令需要 P01/T01 先交付入口。实现任务还须引用待验收提交上的 `pnpm check:all` 结果；计划本身不构成通过证据。

### 执行与验收记录

2026-09-20 原源画布渲染边界：默认 Studio 的路径及节点/控制柄 SVG 机械抽取到 `source-canvas-layers.tsx`，保留 data 属性、样式、命中宽度和原事件回调。`beginV4PointGesture` 把该 DOM 的曲线/点命中映射成捕获的稳定源身份，`useSourceDrag` 管理指针生命周期、门槛、限轴和取消。内置 Sandrone fixture 用相同组件验证实际节点/控制柄拖动和单次撤销；默认根尚未注入 V4 手势，框选、整路径移动、吸附和端点双击续画还需要逐项接线，不可提前签收完整画布旅程。

2026-09-20 参考图与文件能力适配：`createStudioHost` 为根控制器管理打开/恢复/释放的资源生命周期，`createStudioPresentation` 从明确参考图与规范 asset bytes 建立原画布 frame 和可释放 URL；无图要求显式 frame，多图要求显式选择，不偷偷改写不兼容仿射。`createStudioFileWriter` 接收已经选定的 Web 句柄或桌面路径，复用授权及串行/原子写入。内置 Sandrone 已通过真实浏览器图片解码、原节点面板编辑/撤销和 OPFS 文件副本保存重开。默认根接线、文件选择对话框、参考图编辑后的展示更新与原生窗口验收仍未完成。

2026-09-20 根会话控制器：`editor/studio-session.mjs` 持有唯一 EditorSession、文件会话和 CreationRuntime，发出可供 React 订阅的稳定 snapshot。打开时校验文档和展示参考系，一次发布完整的新会话状态；旧运行时关闭，撤销历史重置，文件 revision 与编辑状态对齐。原组件 fixture 已改用此订阅，展示路径不再由空数组占位。保存编码权威文档，预览只显示，取消不置脏；恢复以未绑定的修改文档进入。默认 `StudioApp` 尚未使用控制器；参考图资源 URL 生命周期、Web 文件句柄/原生写入适配、完整源回调及 ModelWorkspace 边界仍须接入，不能提前宣称根切换完成。

2026-09-20 原节点动作边界：原主界面的连接方式、指定段直连、批量删点及公开 API 的连接方式统一调用 `source-editor/node-actions.mjs`。旧后端保留原算法，V4 后端将已显示路径的节点/段索引解析为稳定源身份后提交命令；面板继续使用原 `SplineNodeInspector`。主界面状态提示、选区处理与快捷键保留在原位置。该边界不涵盖单节点拟合删除 API、画布拖动、续画、接合或文件会话，因此不能据此签收默认根 V4 切换。

2026-09-20 源编辑共享运行时：`CreationRuntime` 同时提供 `readSourceView`、`commandSource`、`commandPath` 和 `beginSourceGesture`，共用私有展示句柄、单一 EditorSession 和历史。源命令从已展示的稳定身份编译，拖动使用固定基线；参考图坐标系在运行时创建时捕获，屏幕缩放/平移不改变它，参考系变更须重建运行时。连续相同坐标采样仍按预览版本使旧句柄失效。专项测试覆盖共享历史、实时派生结果及取消/换文档保护；原主画布回调和默认根会话注入仍待完成，不能签收完整源编辑旅程。

- 认领人 / 时间：
- 起始提交 / 合同版本：
- 实现提交 / 关键变更：
- 实际命令、结果、环境及证据路径：
- U/A 编号与 fixture：
- P00 接线提交 / 合同或范围变更：
- 遗留问题 / 阻塞条件：
- 验收人 / 日期 / 结论：

<a id="t16"></a>

## T16 · 默认画布与直接编辑接入

- 状态：进行中：真实 Worker 候选画布已挂载，两端四项基本旅程通过，完整曲线交互仍待完成
- 执行者 / 验收者：未分配
- 前置：[T01](01-validation-2026-09-19.md#t01)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T13 基础签收](06-editing-runtime-and-api-2026-09-19.md#t13)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)
- 下游：[T21](01-validation-2026-09-19.md#t21)
- 覆盖原工作包：R4
- 验收复核：主代理与验证负责人走真实交互，不仅检查组件快照。

### 目标与代码背景

在保持现有工具习惯的前提下，将源编辑与整体移动接入 V4 命令和结果投影。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/components/studio/studio-app.tsx](../../src/components/studio/studio-app.tsx)
- [src/components/source-editor/spline-inspector.tsx](../../src/components/source-editor/spline-inspector.tsx)
- [src/components/source-editor/endpoint-snap-overlay.tsx](../../src/components/source-editor/endpoint-snap-overlay.tsx)
- [src/lib/source-editor/canvas-gestures.mjs](../../src/lib/source-editor/canvas-gestures.mjs)

### 可写范围

- src/components/source-editor/ 下现有组件的投影与命令适配（具体文件由 P00 分配，保留 DOM/CSS）
- src/hooks/use-v4-canvas-gestures.ts（新增）
- scripts/tests/browser/v4/test-basic-authoring.cjs（新增）
- scripts/tests/browser/v4/test-object-move.cjs（新增）

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. H 改 pose，A/P 编辑稳定实体与自由参数；屏幕/world/local 转换统一；保持右键/空格/中键平移和4px手势阈值。
2. 线、面、派生副本选取与“编辑母线”明确范围；F 使用求值结果；取消/失焦/捕获丢失与一次撤销完整。
3. 向 I00 提供 props 清晰的组件/手势接入，不直接重写共享根组件状态。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A01–A03、A06、A08、A11、A13、A20；U01/U02/U04**；最终标准见架构方案第 10 节。

- [ ] 真实指针完成 U01/U02 核心操作；镜像/阵列整体移动后继续调节点，局部 Sketch/Program 不被移动重写。
- [ ] 候选区域不重复列树，普通闭合不要求打开构造；编辑输入草稿不写向刚切换的新选区。
- [ ] Web 和 desktop-frontend 各跑对应 V4 浏览器用例；截图仅作补充，结构/几何断言必须存在。

验证命令：

```sh
pnpm test:browser --suite v4 --case basic-authoring --target web
pnpm test:browser --suite v4 --case object-move --target desktop-frontend
```

上述 `test-v4-*.mjs` 是拟新增测试文件，交付后即可直接用 Node 运行，并由现有 `pnpm test` 自动枚举；Node 单测不等待浏览器 runner。只有列出的 `pnpm test:browser` 命令需要 P01/T01 先交付入口。实现任务还须引用待验收提交上的 `pnpm check:all` 结果；计划本身不构成通过证据。

### 执行与验收记录

- 认领人 / 时间：
- 起始提交 / 合同版本：
- 实现提交 / 关键变更：
- 实际命令、结果、环境及证据路径：
- U/A 编号与 fixture：
- P00 接线提交 / 合同或范围变更：
- 遗留问题 / 阻塞条件：
- 验收人 / 日期 / 结论：

<a id="t17"></a>

## T17 · 作品树、区域属性与按需构造详情

- 状态：待重接：原作品树与属性面板保持，简化候选面板的挂载不计交付
- 执行者 / 验收者：未分配
- 前置：[T01](01-validation-2026-09-19.md#t01)、[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T13 基础签收](06-editing-runtime-and-api-2026-09-19.md#t13)、[T15](07-editor-experience-2026-09-19.md#t15)
- 下游：[T21](01-validation-2026-09-19.md#t21)
- 覆盖原工作包：R5/R6/R7
- 验收复核：主代理核对用户术语与默认路径；验证负责人验收任务完成。

### 目标与代码背景

让默认界面保持部件、线条、区域、颜色/厚度；复杂构造按任务展开。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/components/creation/creation-workspace.tsx](../../src/components/creation/creation-workspace.tsx)
- [src/components/creation/property-navigation.tsx](../../src/components/creation/property-navigation.tsx)
- [src/components/creation/creation-modifiers.tsx](../../src/components/creation/creation-modifiers.tsx)
- [src/components/creation/creation-print-stack.tsx](../../src/components/creation/creation-print-stack.tsx)
- [docs/interaction-design-2026-09-19.md](../../docs/interaction-design-2026-09-19.md)

### 可写范围

- src/components/creation/ 下现有作品树/属性/构造面板的只读投影与命令适配（具体文件由 P00 分配）
- scripts/tests/browser/v4/test-progressive-workspace.cjs（新增）
- scripts/tests/browser/v4/test-repeated-motif.cjs（新增，U04）
- scripts/tests/browser/v4/test-reference-space.cjs（新增，U05）

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 组/部件树，按需线/区行；改父级、排序与源转移分开；不默认生成源/基准/程序/结果四个目录或 Collection 管理器。
2. 保留工具/工程/选区导航，区域颜色/厚度直接编辑，普通工程有默认成品；分层启用后才显示层数。基本 UI 可先交付，分层/Part 属性须等 T13 制造签收后完成验收。
3. 镜像/重复/连接边界、引用形状/按位置切割使用任务名称；错误先给具体原因和修复入口，返回普通属性不留技术目录。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A04、A07、A09、A12、A17、A20；U02–U06**；最终标准见架构方案第 10 节。

- [ ] U02–U05 使用独立明确 case 验证结果；U06 与 P02/T19 的 failure-repair-reopen 衔接。普通入口不要求 Source/Port/Collection/local/world 技术设置；高级展开/收起不改 Document。T17 先验证失败/修复显示，跨文件重开由 T19/T21 补完整旅程。
- [ ] 组操作不把孩子的一套修改器当成组属性，批量操作范围可见；树排序不改 Z/制造。
- [ ] 向 I00 提供明确 props，不能与 T16 同时编辑根工作区或引入第二套选择状态。

验证命令：

```sh
pnpm test:browser --suite v4 --case progressive-workspace --target web
pnpm test:browser --suite v4 --case repeated-motif --target web
pnpm test:browser --suite v4 --case reference-space --target web
```

上述 `test-v4-*.mjs` 是拟新增测试文件，交付后即可直接用 Node 运行，并由现有 `pnpm test` 自动枚举；Node 单测不等待浏览器 runner。只有列出的 `pnpm test:browser` 命令需要 P01/T01 先交付入口。实现任务还须引用待验收提交上的 `pnpm check:all` 结果；计划本身不构成通过证据。

### 执行与验收记录

- 认领人 / 时间：
- 起始提交 / 合同版本：
- 实现提交 / 关键变更：
- 实际命令、结果、环境及证据路径：
- U/A 编号与 fixture：
- P00 接线提交 / 合同或范围变更：
- 遗留问题 / 阻塞条件：
- 验收人 / 日期 / 结论：

2026-09-20 原修改器组件接线：`CreationModifiers` 能直接读取 V4 `modifierStatus.controls`，在原卡片与样式中修改名称、启用和支持的标量。`modifierModel: 'program'` 区分构造图与旧栈，空构造图不误显示“直接使用基础面”或旧新增命令。独立真实浏览器 fixture 验证输入→V4 会话→重新求值、一次撤销、原曲线不变、驱动/缺失/锁定保护和原样式。纯曲线阶段的原添加表单现支持镜像/阵列，通过同一 V4 会话接到当前已发布曲线；已发布区域时明确拒绝此简化入口，避免只改曲线却不影响区域或暗中重接构造图。构面接合、已有区域的新增、删除排序、来源与范围仍未接入，默认根入口尚未使用此 V4 会话，不能签收 U02–U06 或原生文件旅程。

2026-09-20 派生样条预览：原 `useCurvePreview` 接受同一 CreationRuntime，通过 V4 当前曲线快照同步投影世界毫米坐标，保留原开关、阶段选择及 SVG/3D DTO。预览从明确的曲线发布端口取最终结果；失效不回退中间成功步骤。端点依据共享顶点和显式 Join，显示读取不生成可写 Path。单测覆盖拖动同 ID 更新、取消和过期句柄；原组件浏览器覆盖实际曲线 SVG、阶段切换及失效空输出。默认根 runtime 注入、实际源画布拖动和双端完整旅程仍未签收。

2026-09-19 模块证据与阶段限制统一记录于[验收索引](acceptance-2026-09-19.md#实施检查记录--2026-09-19)。模块测试通过不等于完整旅程或默认切换签收。

2026-09-20 原整线拖动适配：`beginV4PathGesture` 从捕获的源视图收集并去重节点身份，重复预览始终相对按下时基线；`useSourceDrag` 统一节点、控制柄和整线的指针捕获、门槛、限轴、取消和单次提交。单测验证旋转部件、闭合线、共享路径使用不重复位移、控制柄形状和撤销；内置 Sandrone 原 SVG 命中层验证实际整线拖动与撤销。此动作仅修改源几何；原 `translatePaths` 还联动涂色和分区种子，默认根接线前必须明确保留其可见结果，不能把该适配器直接视为完整对象移动。

2026-09-20 移动联动核验：旧 paint.geometry / split.seed 是空间匹配辅助输入；导入后已转换为 output refs/contracts，不应在 V4 手势中继续平移这些派生数据。`test-v4-path-move-equivalence.mjs` 验证 Sandrone 头发移动后的全部 69 个区域与旧实现对齐，以及旧分区样例 11 组涂色在全部相关源同移后保持几何/颜色/厚度；程序、输出契约和节点 pose 不变，一次撤销恢复。原固定算子中心/边界同样不随源线平移，拓扑改变仍应阻断。这解除上一条记录中的涂色/分区补偿疑问；默认根实际接线和完整旅程仍未签收。

2026-09-20 端点吸附接线：CreationRuntime 新增已提交视图上的 `readEndpointSnapContext`；`useSourceDrag` 在单节点手势开始时捕获目标，在原屏幕距离规则下提供反馈，Alt/Shift 绕过吸附，结束清理反馈。原 SVG 真实鼠标 fixture 覆盖吸附/绕过/限轴/取消/撤销。V4 目标投影读取当前构造求值和稳定源身份，不把派生坐标写为 Path。默认根尚未注入该手势，框选、续画及完整双端旅程仍待接线。

默认根后续接线必须区分对象与源编辑：`CreationWorkspace.prepare_move` 当前只返回 pathIds，旧根据此调用 translatePaths；V4 对象移动须传 nodeIds 并通过 move-nodes 更新部件 pose，不能把已验证的 beginV4PathGesture 当作对象移动验收。此整理保留原工具/布局，改正对象组织与变换权威。

2026-09-20 部件位姿手势：runtime.beginObjectGesture 接 nodeIds，通过 move-nodes 写场景 pose；共用 runtime-gesture 维护源/对象预览的同一会话边界。原 prepare_move 开始返回 nodeIds，V4 手势 hook 具备对象入口。旋转父组、父子同时选中、派生镜像跟随、原始定义不变和 Sandrone 原 SVG 实际鼠标检查通过。默认根仍待注入 StudioHost/runtime，当前只有原组件 fixture 接线，不能签收默认对象移动旅程。

2026-09-20 原根可注入会话：原 `StudioApp` 接受可选 `StudioHost`，通过订阅读取唯一会话的只读展示投影；原组件布局保留。V4 分支接入源节点操作、节点/柄拖动及吸附、按 nodeIds 的部件移动、撤销/重做、保存及自动草稿。旧 Project 事务在该分支明确拒绝，不能回写显示投影。默认无 host 入口继续原行为。完整原根浏览器验收脚本为 `test-v4-original-studio.cjs`；新建/打开、参考图修改、描绘、源树部分操作、建模和完整 API 写入仍未接线，不构成默认切换或全部旅程签收。

2026-09-20 文件打开接线：V4 分支的原浏览器选择器、文件 input、桌面选择器及原生打开事件共用 `loadProjectFile` → `openProject` → `host.open`，保持格式识别、参考资源生命周期、历史清空和文件绑定在统一会话内；旧工程不绑定原文件。“载入示例工程”不再经过旧可写 Project API。真实原界面测试覆盖 V4 重开、旧版导入、损坏文件保留当前工程和示例菜单。原生对话框与实际磁盘打开仍待原生验收；新建、参考图编辑、描绘、建模和完整 API 写入仍未完成。

2026-09-20 从图片新建：保留原图片类型/大小检查、解码及超大图缩小流程，V4 分支通过 `createReferenceProject` 直接创建空规范文档和资源，不经旧工程导入。新工程默认宽 100 mm、新建厚度 2 mm，未保存且无绑定，历史和选区清空；读取期间工程变化则拒绝迟到的新建结果。单测覆盖资源所有权和容器往返；原根浏览器覆盖新图显示、空源/部件、历史/绑定清空及保存副本。描绘、参考图编辑、建模和完整 API 写入仍待接线。

2026-09-20 普通轮廓描绘接线：原 CreationWorkspace 暴露只读 `trace_target`，返回当前部件与待画线语义；原根通过 `start-path` / `extend-path` / `close-path` 写统一 V4 会话，保留原落点吸附、拟合、预览、手动直连和首尾方向。命令使用拟合前捕获的项目视图，迟到结果不能写入已变化的工程。普通 source/fill 部件可追加轮廓；复杂构造沿用显式来源保护，分区/挖洞待适配，不允许静默退化为普通轮廓。后续仍须补齐角色化绘制、批量候选路径与高级拟合等入口。

后续角色绘制接线依据：现有 `draw-partition` / `draw-hole` 与 `createRegionCommand` 可使用准确 OutputRef 目标及独立 raw Sketch，保留高级构造和赋值迁移；不能放宽 `basicProgram` 后暗中改写旧输出。增量绘制还需要明确捕获目标、未完成路径的持久化语义和完成时机。新增普通轮廓并入已有高级部件时，应保留旧区域输出身份，研究 source → fill → region-collect 的显式追加，而非替换既有程序。上述为后续待实施边界，尚未签收。

2026-09-20 追加轮廓命令基础：`append-boundary` 接收同一部件内尚未接入构造的闭合 PathRef，以 Source → Fill → region-collect 追加独立区域，曲线用 curve-collect 保留原实例与 Join。共享 ID 分配器防止覆盖旧算子。真实 Sandrone 与金色徽章、镜像/阵列/Join fixture 验证原源、算子、区域身份、颜色/厚度/制造赋值保持以及一次撤销；结构性汇总不出现在默认修改器列表。此项只完成命令基础，增量角色绘制与原根 UI 接线仍待实现，不代表默认切换签收。

2026-09-20 增量区域绘制接线：`start-path` 可接 divider/hole 与准确 targets，首点即写入 raw Path 与未发布真实分支；`finish-path` 完成分区，`close-path` 闭合并完成孔，复用原子分区/挖孔的契约和赋值迁移。原根在开始动作时捕获目标，避免清空选区后误建新部件；Enter、Esc、右键结束及描绘结束按钮进入同一完成命令，未完成或失效时保留源线供续画。普通修改器不能误启用 pending 分支，显示角色从实际输入链推导。保存/重开、复制两种分支继续完成、删除保留可诊断引用均有命令测试。原根浏览器状态以本轮 QA 记录为准；高级部件追加普通轮廓的增量 UI、目标失效后的修复、批量拟合、建模及 API 仍需后续完成。

2026-09-20 高级轮廓增量：原画轮廓入口已支持复杂部件的独立未发布 Fill 分支，首点保存、重开续画、闭合发布与单步撤销均复用统一命令。两份真实样例的旧输出身份、Join、原源和赋值保持；复制 pending 轮廓后可独立完成。原根鼠标测试覆盖分区、挖洞后再追加轮廓、撤销重做与规范保存。默认入口、参考图编辑、批量拟合、建模及完整 API 仍待完成。

2026-09-20 原源线动作补齐：隐藏/显示与删除路径调用捕获源视图的 set-paths / delete-paths；端点合并调用 merge-paths，保留原端点选择、直连提示和单步撤销。公开单点删除入口复用节点命令适配器。原端点辅助线改用 V4 吸附查询，预览期间固定读取本次提交基线与不可变画布 frame，避免读取旧 Creation 结构或追逐移动副本。真实原根浏览器结果见本轮 QA；默认入口及完整 API 仍未签收。

2026-09-20 原重新拟合接线：原确认弹窗、单段拟合器和忙碌状态保留；V4 使用当前源边的有向端点逐段拟合，不按旧锚点距离过滤短边，不替换整个 TracePath。结果通过捕获工程视图的 refit-path 命令写控制柄，保持 Vertex/Edge/Program 身份；异步期间工程变化则拒绝迟到结果，受关系驱动或共享边由既有命令明确拒绝。确认取消与执行、控制柄编辑后拟合及撤销重做的实际界面证据见本轮 QA。候选路径、工程尺寸、建模与默认切换仍待完成。

2026-09-20 V4 候选路径接线：原 create_path 的逐段拟合结果通过 draw-path 像素意图转换为规范 Source，不经过旧 Project 写回。preview 只保留会话候选与捕获的提交计划，接受时一次写入；丢弃不创建节点、历史或文件变更，迟到拟合与失效接受由版本检查拒绝。普通新建沿用单独部件语义。候选返回的临时 id 仅用于预览，直接创建或 commit_preview 返回已提交的源路径显示 id；不将临时 TracePath 持久化。原接受按钮报告失效原因并保留候选供丢弃。原 batch API 与 UI 的实际验收见本轮 QA，完整 API 与默认入口仍待完成。
