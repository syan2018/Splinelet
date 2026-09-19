# P05 · 外观浮雕、制造放置与导出

建档：2026-09-19。**这是一个分发工作包；T 编号是包内验收检查点，不要求为每个 T 新开执行任务。**

- 包负责人 / 验收者：未分配
- 建议角色：浮雕、制造与实体负责人
- 执行状态：见下面各检查点；当前均未开始
- 起始提交 / 合同版本：分发时填写
- 总控：[范围、合同、最快可行调度与门槛](README.md)
- 设计依据：[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)
- 仓库约定：[AGENTS.md](../../AGENTS.md)

## 背景与要交付的改变

现有颜色、厚度和底面信息分布在 feature、对象、paint、surfaceGraph 与 modifier styles；creation-engine 混合面、属性与体块。重构必须让区域到用户可见浮雕、制造放置与实体之间的转换明确，同时保留层数、切削、材料和导出能力。

用户继续直接设置颜色/厚度；内核依次得到 ReliefSet、PlacedReliefSet、BodySet；同一 Shape 可以有多个区域/底面/实体，Group 不变成制造 Part。

## 在整条管线中的位置

输入 RegionSet、赋值、世界变换与制造方案；输出阶段化浮雕/实体、有效属性和指定阶段的 SVG/Blender/3MF 等出口。

不重新解释旧 features，不把结果写回持久字段，不执行平台下载。复用既有几何和格式内核，签名变化交 P00 串行整合。

所有包共同守护：部件身份不依赖输出类型/数量；源定义是唯一权威，求值结果只读；普通用户的默认概念只有部件、线条、区域、颜色和厚度，高级业务按需展开。技术正确与默认体验同时验收。

## 如何分发本包

先读本页背景、总控第 1–2 节及相关代码入口；开工前记录已验收的上游提交和合同版本。只启动依赖已就绪的检查点，不需等前一工作包全部做完，也不能跳过本检查点依赖。负责人可连续完成多个检查点，或在总控许可的非重叠范围内分给临时协作者。

- [T09 外观与浮雕赋值解析](#t09)：[T02](02-document-and-persistence-2026-09-19.md#t02)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)
- [T10 层数、依附、放置与制造映射](#t10)：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)
- [T11 实体内核适配与分阶段导出](#t11)：[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10) 及 [C03 联合签收](04-evaluation-and-operators-2026-09-19.md#c03-interop)

交付物先做覆盖面的最小验证，再交 P00 接线；同一待验收提交上的全量检查证据可以被多个检查点引用，不重复跑同一批构建。各检查点仍需自己的反例和语义验收。全部小项写完之前，下游可以使用已单独签收的检查点交付。

禁止修改未授权公共文件或其他执行者的工作；需扩范围时给出具体文件、理由、消费者影响，由 P00 登记后执行。

<a id="t09"></a>

## T09 · 外观与浮雕赋值解析

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T02](02-document-and-persistence-2026-09-19.md#t02)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)
- 下游：[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T15](07-editor-experience-2026-09-19.md#t15)、[T18](02-document-and-persistence-2026-09-19.md#t18)
- 覆盖原工作包：R2/R7
- 验收复核：主代理检查属性/几何分层与用户默认语义。

### 目标与代码背景

由 RegionSet 和持久赋值产生 ReliefSet；将颜色与2.5D几何语义分开，用户仍用颜色/厚度面板。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/creation-engine.mjs](../../src/lib/creation-engine.mjs)
- [src/lib/creation-colors.mjs](../../src/lib/creation-colors.mjs)
- [src/lib/creation-styles.mjs](../../src/lib/creation-styles.mjs)
- [src/lib/creation-commands.mjs](../../src/lib/creation-commands.mjs)

### 可写范围

- src/lib/relief/（新增 appearance、assignments、resolve）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 解析部件默认与区域覆盖，统一 swatch、参与成品、厚度、add/cut/through、放置意图及材料引用。
2. 保留逐区域厚度/底面/模式；首次上色的成品启用语义由 T13 调用，解析器不自行修改定义。
3. split/merge 的继承映射、局部覆盖及冲突/失效表示可供 UI 与迁移共用。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A10、A20、A21；U01/U02**；最终标准见架构方案第 10 节。

- [ ] 改变某区域颜色或厚度不改 RegionSet 几何/兄弟赋值；未启用候选不因默认颜色变成实体。
- [ ] 输出引用丢失后赋值可保留并在修复后恢复；删除色卡正确处理所有有效引用。
- [ ] mm/layers 是互斥权威表达，未完成制造解析时不伪造物理高度。

验证命令：

```sh
node scripts/tests/unit/test-v4-relief.mjs
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

<a id="t10"></a>

## T10 · 层数、依附、放置与制造映射

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)
- 下游：[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T18](02-document-and-persistence-2026-09-19.md#t18)
- 覆盖原工作包：R2/R7
- 验收复核：制造负责人自证体积/高度，主代理审查依赖与模式转换。

### 目标与代码背景

把 ReliefSet 解析为 PlacedReliefSet；保持整数层数、逐输出高度和场景/制造分责。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/print-stack.mjs](../../src/lib/print-stack.mjs)
- [src/lib/solid-engine.mjs](../../src/lib/solid-engine.mjs)
- [scripts/tests/unit/test-print-stack.mjs](../../scripts/tests/unit/test-print-stack.mjs)

### 可写范围

- src/lib/manufacturing/（新增 dimensions、placement、parts）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 先解析权威厚度，再计算自由/依附/打印层放置；计算 Part 成员与材料信息，应用统一世界框架。
2. 保留旧 zOffset、useObjectZ 有效语义所需的明确放置模式；同一记录只选一个模式。
3. 默认成品归属与按需多零件；visible/locked 与制造排除独立，组批量分层只是叶部件命令。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A04、A16、A21；U01/U03**；最终标准见架构方案第 10 节。

- [ ] 改层高不重舍入整数层数；下层厚度变化提升上层；依附缺失/环路和失效上游阻断正确范围。
- [ ] 同 Shape 多个底面、隐藏但参与导出和显式排除分别可断言；编组/重排不改变制造归属。
- [ ] 不得把解析后的毫米数写回多份历史字段。

验证命令：

```sh
node scripts/tests/unit/test-v4-manufacturing.mjs
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

<a id="t11"></a>

## T11 · 实体内核适配与分阶段导出

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10) 及 [C03 联合签收](04-evaluation-and-operators-2026-09-19.md#c03-interop)
- 下游：[T18](02-document-and-persistence-2026-09-19.md#t18)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)、[T21](01-validation-2026-09-19.md#t21)
- 覆盖原工作包：R7
- 验收复核：验证负责人检查格式结构与体积，主代理审查实体适配边界。

### 目标与代码背景

让实体与导出消费新的结果域，复用 Manifold、格式和材料算法，移除新结果转旧 features 的依赖。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/solid-engine.mjs](../../src/lib/solid-engine.mjs)
- [src/lib/material-solids.mjs](../../src/lib/material-solids.mjs)
- [src/lib/mesh-format.mjs](../../src/lib/mesh-format.mjs)
- [src/lib/three-mf.mjs](../../src/lib/three-mf.mjs)
- [src/lib/bambu-3mf.mjs](../../src/lib/bambu-3mf.mjs)
- [src/lib/project.ts](../../src/lib/project.ts)

### 可写范围

- src/lib/solid/（新增结果适配层）
- src/lib/export/（新增阶段化适配层）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. PlacedReliefSet → BodySet：按 Part 合并凸起、切削/贯穿与材料体积，保留诊断和来源。
2. 源曲线 SVG、分色 SVG、Blender 源/实体、通用3MF、Bambu3MF和 STL 兼容出口分别指定阶段/坐标/精度。
3. 纯适配不执行平台下载；旧内核复用如需签名调整，向 I00 提交局部补丁及双调用回归。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A16、A21、A23；U01/U04**；最终标准见架构方案第 10 节。

- [ ] 孔、cut/through、多材料、多 Part、整数层、有效边、连通与体积逐项断言；不把 Group 变成 Part。
- [ ] 源 SVG 保留源 cubic，派生纹样不误导出为原始线；Blender/3MF 使用同 revision 的放置与实体。
- [ ] Bambu 模板与参数引用保持；Worker/wasm 路径经 I00 双端生产构建验证。

验证命令：

```sh
node scripts/tests/unit/test-v4-export.mjs
pnpm test:export
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
