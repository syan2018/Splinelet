# P04 · 依赖求值、曲线和区域构造

建档：2026-09-19。**这是一个分发工作包；T 编号是包内验收检查点，不要求为每个 T 新开执行任务。**

- 包负责人 / 验收者：未分配
- 建议角色：构造管线负责人；主代理复核 DAG/几何
- 执行状态：求值与算子模块已实现，真实 C03 联合链通过；完整业务覆盖待验收
- 起始提交 / 合同版本：分发时填写
- 总控：[范围、合同、最快可行调度与门槛](README.md)
- 设计依据：[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)
- 仓库约定：[AGENTS.md](../../AGENTS.md)

## 背景与要交付的改变

旧管线会按栈内是否含曲线操作猜来源，还并存 region recipe、分区、source 栈和 object 栈。V4 将它们编制成明确的平面 Program，发布 CurveSet/RegionSet，并让身份与诊断沿算子传递。

普通闭合、多来源分区、重复纹样、纯引用都使用同一套类型化端口和调度；失败仍保留有效上游线条；加算子不增加默认用户概念。

## 在整条管线中的位置

输入 P03 的局部源与关系，以及 C03 的端口合同；输出只读阶段结果、provenance、依赖索引和 snapshot，交给 P05/P06/P07。

T06 交付后 T07 与 T08 可以并行；T08 独占 Fill/Path 构面语义，T07 只交付精确曲线与连接。纯求值不得补写 Document，也不得调用 legacy importer。

所有包共同守护：部件身份不依赖输出类型/数量；源定义是唯一权威，求值结果只读；普通用户的默认概念只有部件、线条、区域、颜色和厚度，高级业务按需展开。技术正确与默认体验同时验收。

## 如何分发本包

先读本页背景、总控第 1–2 节及相关代码入口；开工前记录已验收的上游提交和合同版本。只启动依赖已就绪的检查点，不需等前一工作包全部做完，也不能跳过本检查点依赖。负责人可连续完成多个检查点，或在总控许可的非重叠范围内分给临时协作者。

- [T06 有类型 Program、依赖调度与结果快照](#t06)：[T02](02-document-and-persistence-2026-09-19.md#t02)、[T03](03-scene-and-source-geometry-2026-09-19.md#t03)
- [T07 曲线来源、重复与连接算子](#t07)：[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)
- [T08 区域算子、输出身份与局部作用域](#t08)：[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)

交付物先做覆盖面的最小验证，再交 P00 接线；同一待验收提交上的全量检查证据可以被多个检查点引用，不重复跑同一批构建。各检查点仍需自己的反例和语义验收。全部小项写完之前，下游可以使用已单独签收的检查点交付。

禁止修改未授权公共文件或其他执行者的工作；需扩范围时给出具体文件、理由、消费者影响，由 P00 登记后执行。

<a id="t06"></a>

## T06 · 有类型 Program、依赖调度与结果快照

- 状态：模块交付；域/端口/依赖/缓存/四状态测试通过
- 执行者 / 验收者：未分配
- 前置：[T02](02-document-and-persistence-2026-09-19.md#t02)、[T03](03-scene-and-source-geometry-2026-09-19.md#t03)
- 下游：[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)
- 覆盖原工作包：R2/R3
- 验收复核：主代理审查 DAG、空间及失效粒度。

### 目标与代码背景

建立单一类型化调度与阶段结果边界；具体算子归 T07/T08，线程传输归 T14。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/modifier-stages.mjs](../../src/lib/modifier-stages.mjs)
- [src/lib/modifier-engine.mjs](../../src/lib/modifier-engine.mjs)
- [src/lib/creation-engine.mjs](../../src/lib/creation-engine.mjs)
- [src/lib/model-worker.ts](../../src/lib/model-worker.ts)

### 可写范围

- src/lib/construction/types.ts（新增）
- src/lib/construction/registry.mjs（新增）
- src/lib/construction/evaluate.mjs（新增）
- src/lib/construction/dependencies.mjs（新增）
- src/lib/construction/snapshot.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 注册表声明输入/输出域、空间、参数、旁路与 provenance；Program 发布曲线/区域端口，禁止 usesCurvePipeline 式猜来源。
2. 依赖图按参数/变换/源/算子端口/放置组件建立；支持 local/world 引用、反向影响索引和可读循环路径。
3. 不可变 EvalSnapshot 区分 ready、合法 empty、无此输出及 blocked；按依赖键失效，单纯位移复用可复用的局部结果。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A03、A05、A09、A13、A18、A19、A23**；最终标准见架构方案第 10 节。

- [ ] 独立基准驱动另一对象再回到本对象下游不误判成环；真实上游读自身下游必须失败。
- [ ] 禁用域不兼容步骤显式阻断；上游失败仍发布本次有效曲线，不能回退旧面或写工程。
- [ ] world-result 接收对象自身移动与来源移动均使正确下游失效；颜色变更不重算不相关平面几何。

验证命令：

```sh
node scripts/tests/unit/test-v4-evaluation.mjs
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

<a id="t07"></a>

## T07 · 曲线来源、重复与连接算子

- 状态：模块交付；真实 Source/Mirror/Array/Join 联合测试通过
- 执行者 / 验收者：未分配
- 前置：[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)
- 下游：[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T18](02-document-and-persistence-2026-09-19.md#t18)
- 覆盖原工作包：R2/R6
- 验收复核：主代理核对拓扑与原曲线精度，验证负责人检查重复用例。

### 目标与代码背景

将精确源曲线经变换、镜像、阵列与 Join 生成 CurveSet；构面转换统一由 T08 实现，二者按 C03 合同并行。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/curve-modifiers.mjs](../../src/lib/curve-modifiers.mjs)
- [src/lib/curve-transforms.mjs](../../src/lib/curve-transforms.mjs)
- [src/lib/source-editor/endpoint-snap.mjs](../../src/lib/source-editor/endpoint-snap.mjs)
- [scripts/tests/unit/test-curve-pipeline.mjs](../../scripts/tests/unit/test-curve-pipeline.mjs)

### 可写范围

- src/lib/construction/operators/curves/（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. Source、曲线 Transform/Mirror/Array、Join 的注册实现；输出携带源 edge/end、实例与可编辑性。
2. Join 只建立端点拓扑与明确连接关系，不构面、不自动补线；保持精确 cubic，向 T08 的 Fill 交付闭环或开放曲线。
3. 开放母线到完整纹样保留尖角、中心缺口及每步诊断；与 T08 接通后验证环/孔，供同步预览与 Worker 共用。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A02、A03、A07–A09、A19；U04**；最终标准见架构方案第 10 节。

- [ ] 重复 fixture 验证开放 1/8、镜像、四向阵列、端点连接及世界移动；停用/恢复步骤及合法空输出正确。
- [ ] 屏幕吸附距离与几何容差无混用；补边必须来自明确输入，不在 Fill 里自动加线。
- [ ] 独立验证精确曲线、端点连接和方向；区域/孔与完整链在下面 C03 联合签收单独验证，不阻塞 T07/T08 各自的独立签收。

验证命令：

```sh
node scripts/tests/unit/test-v4-curve-operators.mjs
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

<a id="t08"></a>

## T08 · 区域算子、输出身份与局部作用域

- 状态：模块交付；Fill/区域算子/来源测试通过，业务命令接线进行中
- 执行者 / 验收者：未分配
- 前置：[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)
- 下游：[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T18](02-document-and-persistence-2026-09-19.md#t18)
- 覆盖原工作包：R2
- 验收复核：主代理审查几何与身份规则，T18 执行者核对迁移覆盖。

### 目标与代码背景

统一旧平面构造的数学能力及输出身份，避免对不同来源保留不同语义分派。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/region-engine.mjs](../../src/lib/region-engine.mjs)
- [src/lib/partition-engine.mjs](../../src/lib/partition-engine.mjs)
- [src/lib/modifier-engine.mjs](../../src/lib/modifier-engine.mjs)
- [src/lib/surface-lineage.mjs](../../src/lib/surface-lineage.mjs)
- [scripts/tests/unit/test-modifiers.mjs](../../scripts/tests/unit/test-modifiers.mjs)

### 可写范围

- src/lib/construction/operators/regions/（新增）
- src/lib/construction/provenance.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 统一 Fill 转换及 Path/Stroke/Between/Partition、区域 Boolean/Offset/Array 的类型化算子；普通 Path 构面复用同一 Fill；多 source 子链汇集保留成员身份，不隐式 union。
2. OutputRef、lineage、实例与拓扑契约解析，支持 selected-target；拆分/合并的属性传递只返回明确映射或冲突。
3. 迁移所需旧 region/source/object 栈的能力清单逐项有适配和对照，T18 负责存储转换。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A09、A10、A19、A21、A23；U02**；最终标准见架构方案第 10 节。

- [ ] 仅切一个区域时其他区域不变；来源消失保留 unresolved，不降级全选；孔完全覆盖返回合法空结果。
- [ ] split/merge、嵌套来源与 shared region fixture 保留方向身份；新算子只增加注册实现，不改调度器的来源分类。
- [ ] 完成全部旧 recipe/修改器覆盖表，未支持的类型必须阻止迁移成功，不能静默跳过。
- [ ] 直接使用符合 C03 的真实 CurveSet fixture 独立验证 Fill，T07 并行交付曲线算子；完整曲线到区域用例归下面的 C03 联合签收，不用 mock 成功替代几何运算。

验证命令：

```sh
node scripts/tests/unit/test-v4-region-operators.mjs
node scripts/tests/unit/test-v4-provenance.mjs
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

<a id="c03-interop"></a>

## C03 联合签收：真实曲线到区域

这是包内合同接通检查，不增加分发工作包。状态：真实联合测试通过，完整集成门待验收；执行者 P04，验收者 P00；前置为 T07 与 T08 各自独立签收。

在 `scripts/tests/unit/test-v4-program-interop.mjs` 新增真实 Source → Mirror → Array → Join → Fill 链，验证正常环/孔、合法 empty 与未闭合 blocked；同时保留当前上游曲线、稳定身份及局部/世界变换断言。不得用手工伪造 RegionSet 替代 Fill。

T11/T13 的真实链交付与 G1 须引用本次签收；T09 可继续用已交付 RegionSet 独立开发，不为此停工。

- [ ] 运行 `node scripts/tests/unit/test-v4-program-interop.mjs`（拟新增）。
- [ ] 实现提交 / C03 版本 / fixture / 实际结果已记录。
- [ ] P00 验收人 / 日期 / 结论已记录。

2026-09-19 模块证据与阶段限制统一记录于[验收索引](acceptance-2026-09-19.md#实施检查记录--2026-09-19)。模块测试通过不等于完整旅程或默认切换签收。
