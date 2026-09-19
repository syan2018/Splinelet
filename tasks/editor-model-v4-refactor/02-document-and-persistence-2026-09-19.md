# P02 · 文档、旧工程导入与保存恢复

建档：2026-09-19。**这是一个分发工作包；T 编号是包内验收检查点，不要求为每个 T 新开执行任务。**

- 包负责人 / 验收者：未分配
- 建议角色：文档与持久化负责人
- 执行状态：T02/T18/T19 模块已实现；导入等价性、平台文件恢复装配待验收
- 起始提交 / 合同版本：分发时填写
- 总控：[范围、合同、最快可行调度与门槛](README.md)
- 设计依据：[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)
- 仓库约定：[AGENTS.md](../../AGENTS.md)

## 背景与要交付的改变

Project 目前保存 paths/model/creation 等历史层次，并在读时补归属；.spl ZIP、资源检查、恢复和串行文件写入已经存在，可继续使用。V4 需要把唯一持久定义与运行时结果拆开，同时保住旧工程的可编辑意图、逐输出属性和原件。

无底图的新工程可确定性保存；旧文件只单向导入一次，得到 V4/idMap/report；首次保存另存，草稿与旧版本隔离。

迁移验收必须同时比较初始作品和后续编辑：源点/柄修改后，封口直线、重叠分区、孔洞、镜像阵列、局部颜色和厚度仍按旧意图联动；不能只比较首次求值截图或区域数量。原节点 smooth/symmetric 模式属于编辑语义，不能因初始 cubic 未变而丢弃；如尚未映射，必须记录为未完成，不能切换默认后端。

2026-09-19 阶段结果：内置 Sandrone 69 个区域与补充 gold 70 个区域的初始几何、属性与 V4 容器往返已通过；多连通面、重叠分区和 gold 容差连接已使用动态构造。导入生成紧凑且可重复的内部 ID，保留完整 idMap/report 与输出拓扑合同，不放宽文件大小限制。

**当前仍不签收 T18，必须继续处理：**

- 两份工程的 47/48 个 smooth 节点需保留双向拖柄规则；不能固定一侧为只读关系目标。
- 当前跨 Shape 消费者被复制成独立源，切断旧共享路径后续联动；须按架构第 7 节改成明确外部输入边。
- 当前部分路径组被扩大为整 Shape Collection，须保留精确成员，不能扩大选择/重排范围。
- 开放路径封口暂用共享首顶点的隐藏零长度标记加 Between 表达动态直线；不得向用户展示成可编辑业务来源，原工作区接线前须整理该内部表达。

## 在整条管线中的位置

T02 先提供 DocumentV4/schema/codec 给其他包；待 P04/P05 管线可比较后，T18 导入旧定义；T19 接 P06 的 revision/epoch 完成文件会话。

本包不实现求值算法、场景 UI 或另一份可写旧模型。已有平台/Rust 权限与写入队列仅经 P00 做必要接线。

所有包共同守护：部件身份不依赖输出类型/数量；源定义是唯一权威，求值结果只读；普通用户的默认概念只有部件、线条、区域、颜色和厚度，高级业务按需展开。技术正确与默认体验同时验收。

## 如何分发本包

先读本页背景、总控第 1–2 节及相关代码入口；开工前记录已验收的上游提交和合同版本。只启动依赖已就绪的检查点，不需等前一工作包全部做完，也不能跳过本检查点依赖。负责人可连续完成多个检查点，或在总控许可的非重叠范围内分给临时协作者。

- [T02 V4 文档、验证器与容器编解码](#t02)：[T00](00-architecture-and-integration-2026-09-19.md#t00)
- [T18 旧工程单向导入与全链对照](#t18)：[T01](01-validation-2026-09-19.md#t01)、[T02](02-document-and-persistence-2026-09-19.md#t02)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)
- [T19 打开、保存、恢复与平台边界接入](#t19)：[T02](02-document-and-persistence-2026-09-19.md#t02)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T18](02-document-and-persistence-2026-09-19.md#t18)

交付物先做覆盖面的最小验证，再交 P00 接线；同一待验收提交上的全量检查证据可以被多个检查点引用，不重复跑同一批构建。各检查点仍需自己的反例和语义验收。全部小项写完之前，下游可以使用已单独签收的检查点交付。

禁止修改未授权公共文件或其他执行者的工作；需扩范围时给出具体文件、理由、消费者影响，由 P00 登记后执行。

<a id="t02"></a>

## T02 · V4 文档、验证器与容器编解码

- 状态：模块交付已复核，待集成检查
- 执行者 / 验收者：文档模块执行者 / 主代理
- 前置：[T00](00-architecture-and-integration-2026-09-19.md#t00)
- 下游：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)、[T18](02-document-and-persistence-2026-09-19.md#t18)、[T19](02-document-and-persistence-2026-09-19.md#t19)
- 覆盖原工作包：R1/R2
- 验收复核：主代理检查持久/运行时边界与唯一权威。

### 目标与代码背景

实现唯一持久模型及纯验证/编码；V1–V3 导入归 T18，用户保存会话归 T19。

2026-09-19 分发：起始 ee951b7，合同 v1。先交付并签收 types/schema 与文档单测，允许 T03/T04/T12 的文档消费者开始；codec 随后同包交付，不让 ZIP 细节阻塞纯模块。T02 总状态须两部分都验收才完成。

2026-09-19 模块复核：types/schema/codec 与共享容器提取已交付。主代理补充修复资源 ID 大小写混排导致自身往返失败、编码总大小限额及解压前入口大小检查。`test-v4-document.mjs`、`test-v4-codec.mjs`、旧 `test-project-format.mjs`、类型检查与定向 lint/format 已通过；尚未接入产品打开/保存入口，不代表 T19 或 V4 默认切换完成。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/project.ts](../../src/lib/project.ts)
- [src/lib/project-format.mjs](../../src/lib/project-format.mjs)
- [src/lib/model-schema.mjs](../../src/lib/model-schema.mjs)
- [scripts/tests/unit/test-project-format.mjs](../../scripts/tests/unit/test-project-format.mjs)

### 可写范围

- src/lib/document/types.ts（新增）
- src/lib/document/schema.mjs（新增）
- src/lib/document/codec.mjs（新增）
- scripts/tests/fixtures/v4-document/（新增）
- I00 本轮明确分配 `src/lib/project-container.mjs` 与 `src/lib/project-format.mjs` 的纯 ZIP/hash helper 机械提取；旧 codec 行为和测试须保持。两文件由本执行者独占，完成后交主代理审阅。

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 实现 Group/Shape、Sketch、Datum/Parameter/Relation、Program、外观/浮雕赋值、制造、资源/参考图/旧整理引用的存储类型和结构校验。
2. 区分结构非法与可保存的构造失效；不在 validate/read 里修归属、补算子或清空悬空引用。
3. 实现 documentVersion=4 的纯 codec，保留 ZIP containerVersion=1 的可复用机制和限额；支持无底图、多个合法资源、确定性往返及版本拒绝。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A06、A15、A18**；最终标准见架构方案第 10 节。

- [ ] Shape.programId 与 Program.ownerNodeId 一致；非法实体类型、非有限数和重复 ID 拒绝；合法未完成部件与 unresolved 构造可往返。
- [ ] 资源路径、数量、解压大小、哈希与中断/损坏包测试覆盖；旧 writer 不得把 V4 当 V3 编码。
- [ ] 与旧 project-format 的版本分派补丁交 I00；不得在此导入 React、Worker、文件句柄或平台写入。

验证命令：

```sh
node scripts/tests/unit/test-v4-document.mjs
node scripts/tests/unit/test-v4-codec.mjs
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

<a id="t18"></a>

## T18 · 旧工程单向导入与全链对照

- 状态：模块交付，真实样例可导入；待独立等价比较
- 执行者 / 验收者：未分配
- 前置：[T01](01-validation-2026-09-19.md#t01)、[T02](02-document-and-persistence-2026-09-19.md#t02)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)
- 下游：[T19](02-document-and-persistence-2026-09-19.md#t19)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)、[T21](01-validation-2026-09-19.md#t21)
- 覆盖原工作包：R2
- 验收复核：验证负责人审查独立比较器和报告，主代理确认歧义策略。

### 目标与代码背景

一次导入产生 V4、idMap、报告，以世界结果和编辑语义对照验证，不保留双写的旧模型。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/creation-schema.mjs](../../src/lib/creation-schema.mjs)
- [src/lib/model-schema.mjs](../../src/lib/model-schema.mjs)
- [src/lib/modifier-schema.mjs](../../src/lib/modifier-schema.mjs)
- [src/lib/project-format.mjs](../../src/lib/project-format.mjs)
- [src/lib/creation-styles.mjs](../../src/lib/creation-styles.mjs)
- [scripts/tests/fixtures/surface-lineage.json](../../scripts/tests/fixtures/surface-lineage.json)
- [scripts/tests/fixtures/hair-partition.json](../../scripts/tests/fixtures/hair-partition.json)
- [public/sandrone-example.spl](../../public/sandrone-example.spl)

### 可写范围

- src/lib/document/import/（新增版本入口与单向迁移）
- scripts/tests/fixtures/v4-migration/（新增）
- scripts/tests/helpers/v4-migration-report.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. V1/V2/V3 按版本分派；保留 creation 建模归属，旧 groups 按别名/整理引用保留；含混归属明确报告，不频率投票。
2. 逐项转换 roles、region DAG、feature/source/object 链、禁用步骤、selected targets/outputContract、surfaceGraph/paints/styles/featureSwatches、Z/层/Part/Bambu资源。
3. 旧源原件与报告可恢复；导入失败不返回可正常保存的部分升级文件；旧成功/失败 fixture 分别保持结果与诊断语义。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A10、A14–A16、A19、A21**；最终标准见架构方案第 10 节。

- [ ] 按冻结阈值比较世界 cubic、差集/边界距离、孔/连通、逐输出颜色/厚度/Z、层数、材料体积及实体有效性；不得以截图或放宽容差通过。
- [ ] 同一部件多 source、特定面切割、局部 zOffset、空/开放/纯引用、原失败工程全覆盖。
- [ ] 每个旧引用都在 idMap/报告有去向，重新打开V4不再运行旧归属推导或空间匹配。

验证命令：

```sh
node scripts/tests/unit/test-v4-migration.mjs
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

<a id="t19"></a>

## T19 · 打开、保存、恢复与平台边界接入

- 状态：模块交付，竞态测试通过；待真实平台保存与恢复
- 执行者 / 验收者：未分配
- 前置：[T02](02-document-and-persistence-2026-09-19.md#t02)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T18](02-document-and-persistence-2026-09-19.md#t18)
- 下游：[T21](01-validation-2026-09-19.md#t21)
- 覆盖原工作包：R3/R8
- 验收复核：主代理审查竞态和文件保护；平台负责人在隔离桌面环境补证据。

### 目标与代码背景

使用现有串行写入和平台能力，替换文档/会话编排；V4 与旧草稿和旧源文件隔离。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/persistence/workspace.mjs](../../src/lib/persistence/workspace.mjs)
- [src/lib/platform/index.mjs](../../src/lib/platform/index.mjs)
- [src/lib/platform/browser.mjs](../../src/lib/platform/browser.mjs)
- [src/lib/platform/desktop.mjs](../../src/lib/platform/desktop.mjs)
- [src-tauri/src/files.rs](../../src-tauri/src/files.rs)
- [scripts/tests/browser/test-saving-browser.cjs](../../scripts/tests/browser/test-saving-browser.cjs)
- [scripts/tests/browser/test-restore-race.cjs](../../scripts/tests/browser/test-restore-race.cjs)

### 可写范围

- src/lib/persistence/v4-session.mjs（新增）
- src/lib/persistence/open-project.mjs（新增）
- scripts/tests/browser/v4/test-saving-recovery.cjs（新增）
- scripts/tests/browser/v4/test-failure-repair-reopen.cjs（新增，U06）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 打开旧工程只在内存导入；首次明确保存另存V4并保留原件/报告；V4日后按绑定文件正常保存。
2. V4草稿命名空间不写 session-v2/current；恢复、示例加载、外部打开与用户导入竞争由 epoch 拒绝迟到结果。
3. 保存 snapshot 与当前编辑 revision 分开标识；浏览器句柄/下载fallback/Tauri原子写沿用平台边界，错误不误标已保存。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A13–A15；U01/U06**；最终标准见架构方案第 10 节。

- [ ] 延迟保存/恢复、保存时继续编辑、取消、失败重试、关闭重开、无底图/资源丢失、已失败构造可保存均覆盖。
- [ ] OPFS/测试句柄隔离；旧源字节不变，草稿自动保存不触发显式文件写或下载。
- [ ] I00 对旧 persistence/root 的装配补丁单独审阅；不顺手改变 Rust 文件权限或 bundle.active。

验证命令：

```sh
node scripts/tests/unit/test-v4-persistence.mjs
pnpm test:browser --suite v4 --case saving-recovery --target web
pnpm test:browser --suite v4 --case failure-repair-reopen --target web
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
