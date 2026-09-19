# P03 · 场景组织、源几何与编辑关系

建档：2026-09-19。**这是一个分发工作包；T 编号是包内验收检查点，不要求为每个 T 新开执行任务。**

- 包负责人 / 验收者：未分配
- 建议角色：场景与几何负责人；主代理复核几何语义
- 执行状态：场景、源与有限关系模块已实现；源转移/复制的完整命令装配待验收
- 2026-09-19 增量：原工作区源意图适配已支持双向光滑/对称拖柄与模式切换，Path 按稳定 Vertex ID 保存编辑规则；拆边、反向、删边、复制维护规则和软引用诊断。`test-v4-path-handle-modes.mjs` 与 `test-v4-source-intents.mjs` 覆盖数学行为、锁定、Relation 冲突、撤销及像素到对象局部坐标转换。原根组件的全量命令接线仍待完成，不能据此签收 GUI 旅程。
- 起始提交 / 合同版本：分发时填写
- 总控：[范围、合同、最快可行调度与门槛](README.md)
- 设计依据：[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)
- 仓库约定：[AGENTS.md](../../AGENTS.md)

## 背景与要交付的改变

现在整体移动通过改 path 点坐标完成，修改器中心与开放/纯引用对象不能稳定随动；源节点还有重复端点与数组索引身份。新模型用 Group/Shape pose 表达组织与摆放，用稳定 Sketch 实体和有限关系表达真实可编辑的局部几何。

编组和移动不改源定义或制造；节点/柄有稳定身份；开放母线可以建立并保存明确的中心、轴和接缝关系。

## 在整条管线中的位置

输入 C01 文档与坐标合同；输出场景操作/重表达计划、Sketch 编辑变更、自由量与关系解析，供 P04 求值和 P06 命令调用。

T03 和 T04 目录不重叠，可由两个执行者并行，T05 等两者接口验收后开始。临时吸附不暗写永久关系；不引入通用 CAD 求解器。

所有包共同守护：部件身份不依赖输出类型/数量；源定义是唯一权威，求值结果只读；普通用户的默认概念只有部件、线条、区域、颜色和厚度，高级业务按需展开。技术正确与默认体验同时验收。

## 如何分发本包

先读本页背景、总控第 1–2 节及相关代码入口；开工前记录已验收的上游提交和合同版本。只启动依赖已就绪的检查点，不需等前一工作包全部做完，也不能跳过本检查点依赖。负责人可连续完成多个检查点，或在总控许可的非重叠范围内分给临时协作者。

- [T03 场景身份、编组与坐标变换](#t03)：[T02](02-document-and-persistence-2026-09-19.md#t02)
- [T04 稳定 Sketch 拓扑与源编辑算法](#t04)：[T02](02-document-and-persistence-2026-09-19.md#t02)
- [T05 基准、有限关系与编辑自由量](#t05)：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)

交付物先做覆盖面的最小验证，再交 P00 接线；同一待验收提交上的全量检查证据可以被多个检查点引用，不重复跑同一批构建。各检查点仍需自己的反例和语义验收。全部小项写完之前，下游可以使用已单独签收的检查点交付。

禁止修改未授权公共文件或其他执行者的工作；需扩范围时给出具体文件、理由、消费者影响，由 P00 登记后执行。

<a id="t03"></a>

## T03 · 场景身份、编组与坐标变换

- 状态：模块交付；pose、编组与重表达测试通过，命令接线进行中
- 执行者 / 验收者：主代理 / 独立模块审阅者
- 前置：[T02](02-document-and-persistence-2026-09-19.md#t02)
- 下游：[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T15](07-editor-experience-2026-09-19.md#t15)
- 覆盖原工作包：R1/R5
- 验收复核：主代理审查坐标与引用语义，UI 执行者验证调用边界。

### 目标与代码背景

提供不依赖 UI 或几何内核的场景操作；部件身份独立于产物种类与数量。

2026-09-19：v1 合同已冻结，先实现纯坐标与框架转换；文档操作在 T02 types/schema 签收后接入。`test-v4-transforms.mjs` 已验证嵌套框架、两种引用空间、共享基准、刚性限制和输入不可变；不以此替代整个 T03 验收。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/source-editor/selection.mjs](../../src/lib/source-editor/selection.mjs)
- [src/lib/curve-transforms.mjs](../../src/lib/curve-transforms.mjs)
- [src/hooks/use-creation-selection.ts](../../src/hooks/use-creation-selection.ts)

### 可写范围

- src/lib/scene/（新增 transforms、hierarchy、operations）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 实现 SE(2) local/world、keepWorld reparent、group/ungroup/reorder 与选中祖先去重；有效隐藏/锁定单独求值。
2. 实现复制 ID 映射、内部引用重挂、外部引用保留和删除影响查询的场景部分；源几何转移闭包由 T04/T13 配合。
3. 实现重设原点的重表达计划，包含局部数据及外部 local-result 框架补偿；实际字段更新通过合同中的统一访问器，不硬编码各算子参数。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A01、A04、A05、A11、A12、A17、A18、A22**；最终标准见架构方案第 10 节。

- [ ] 组与子项同时移动只作用一次；编组不改颜色、厚度、制造、Sketch 所有权或世界形状。
- [ ] 空/曲线/区域/失败/纯引用部件均能移动；原点重设后源对象及外部消费者世界结果均保持。
- [ ] 对象移动只改 pose；只读 worldMatrix 和 children 索引均不持久化。

验证命令：

```sh
node scripts/tests/unit/test-v4-scene.mjs
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

<a id="t04"></a>

## T04 · 稳定 Sketch 拓扑与源编辑算法

- 状态：模块交付；精确 cubic/拓扑/转移闭包通过，关系源转移待接线
- 执行者 / 验收者：未分配
- 前置：[T02](02-document-and-persistence-2026-09-19.md#t02)
- 下游：[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T16](07-editor-experience-2026-09-19.md#t16)
- 覆盖原工作包：R1/R4
- 验收复核：主代理审查几何与身份；验证负责人做形状不变量检查。

### 目标与代码背景

将源编辑从数组位置和重复端点迁到稳定实体，保留精确 cubic 与直接操控体验。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/source-editor/node-edit.mjs](../../src/lib/source-editor/node-edit.mjs)
- [src/lib/source-editor/spline-edit.mjs](../../src/lib/source-editor/spline-edit.mjs)
- [src/lib/source-editor/connect.mjs](../../src/lib/source-editor/connect.mjs)
- [src/lib/source-editor/extend.mjs](../../src/lib/source-editor/extend.mjs)
- [src/lib/source-editor/continuity.mjs](../../src/lib/source-editor/continuity.mjs)
- [public/geometry.mjs](../../public/geometry.mjs)

### 可写范围

- src/lib/geometry/sketch.mjs（新增）
- src/lib/geometry/sketch-edit.mjs（新增）
- src/lib/geometry/sketch-transfer.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. Vertex、Edge、Path 有向 use 与相对柄的单一位置表达；插删/拆边/续画/闭合/连接返回变更和引用失效映射。
2. 编辑节点/柄、批量仿射变换和源转移闭包使用稳定 ID；跨 owner 转换框架，不共享可写 Vertex。
3. 纯算法复用既有贝塞尔内核；索引只用于明确快照的旧 API 适配，不进入 V4 内核。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A06、A08、A12、A18**；最终标准见架构方案第 10 节。

- [ ] 未受影响 ID 不变；拆边前后世界 cubic 相同；原有不连续接缝不自动焊接；删除实体保留可修复引用。
- [ ] 一条活动线内多点编辑、尖角/平滑/对称意图可交给 T05 解析；不复制两套可写自由坐标。
- [ ] 不得搬动 public/geometry.mjs 或 /trace-worker.js；若抽取纯 helper，旧调用行为与 Node 导入继续通过。

验证命令：

```sh
node scripts/tests/unit/test-v4-sketch.mjs
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

<a id="t05"></a>

## T05 · 基准、有限关系与编辑自由量

- 状态：模块交付；有限关系与 rebase/ungroup 不变量测试通过
- 执行者 / 验收者：未分配
- 前置：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)
- 下游：[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T17](07-editor-experience-2026-09-19.md#t17)
- 覆盖原工作包：R1/R6
- 验收复核：架构与几何判断由主代理负责；独立复核反例。

### 目标与代码背景

实现首版有限关系和可解释写回；持久关系与屏幕吸附保持分离，不加入通用 CAD 求解器。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/source-editor/endpoint-snap.mjs](../../src/lib/source-editor/endpoint-snap.mjs)
- [src/lib/source-editor/continuity.mjs](../../src/lib/source-editor/continuity.mjs)
- [src/lib/curve-transforms.mjs](../../src/lib/curve-transforms.mjs)
- [scripts/examples/draw-cup-emblem.mjs](../../scripts/examples/draw-cup-emblem.mjs)

### 可写范围

- src/lib/geometry/relations.mjs（新增）
- src/lib/geometry/datums.mjs（新增）
- src/lib/geometry/parameter-edit.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 工程/Group/Shape 基准与共享参数解析；自由点、轴上标量、点引用加偏移、柄连续性按 T00 的白名单实现。
2. 每种关系声明自由量、派生量、编辑投影、解除与冲突诊断；相互依赖进入组件图，禁止任意代码表达式。
3. 为重复构造提供“保持接缝”所需的持久上游关系；普通吸附仅返回临时候选，不暗建/暗删关系。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A07、A08、A09；U04/U06 的内核**；最终标准见架构方案第 10 节。

- [ ] 更改共同中心/方向/允许的重复数后对应关系更新；尖角位置连接不强制平滑；镜像柄逆向编辑方向正确。
- [ ] 保存重开仍有关联；缺失/循环可诊断且不按邻近坐标重绑；解除可由事务撤销。
- [ ] 沿轴拖动改标量、对称柄编辑改共享自由量；Alt 只控制临时吸附。

验证命令：

```sh
node scripts/tests/unit/test-v4-relations.mjs
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

2026-09-19 模块证据与阶段限制统一记录于[验收索引](acceptance-2026-09-19.md#实施检查记录--2026-09-19)。模块测试通过不等于完整旅程或默认切换签收。
