# P06 · 事务、任务命令、Worker 会话与 API

建档：2026-09-19。**这是一个分发工作包；T 编号是包内验收检查点，不要求为每个 T 新开执行任务。**

- 包负责人 / 验收者：未分配
- 建议角色：编辑运行时负责人；主代理复核并发
- 执行状态：见下面各检查点；当前均未开始
- 起始提交 / 合同版本：分发时填写
- 总控：[范围、合同、最快可行调度与门槛](README.md)
- 设计依据：[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)
- 仓库约定：[AGENTS.md](../../AGENTS.md)

## 背景与要交付的改变

GUI、根 transact、各类 API 和 Worker 绑定现在有多个写入口。显式 Program 如果靠用户手工装配，也会把简单描线工具变成复杂 DCC。本包提供唯一事务和任务命令，使普通动作自动维护真实构造，并隔离晚到计算与恢复结果。

画轮廓/分区/洞、首次上色、厚度和重复操作各按一次事务提交；GUI/Agent 共用结果；拖动只撤销一次，旧 revision 不能污染当前工程。

## 在整条管线中的位置

T12 先交付不依赖算子的事务；T14 接 P04 snapshot 管理线程协议；T13 接 P03–P05 的服务编制动作；T20 接旧协议投影并暴露 API 5.0。

Worker 入口、HTTP/WebMCP 和根组件由 P00 装配；本包不维护 React 私有副本，不让求值反向写文档，不用无 revision 的旧索引偷写当前对象。

所有包共同守护：部件身份不依赖输出类型/数量；源定义是唯一权威，求值结果只读；普通用户的默认概念只有部件、线条、区域、颜色和厚度，高级业务按需展开。技术正确与默认体验同时验收。

## 如何分发本包

先读本页背景、总控第 1–2 节及相关代码入口；开工前记录已验收的上游提交和合同版本。只启动依赖已就绪的检查点，不需等前一工作包全部做完，也不能跳过本检查点依赖。负责人可连续完成多个检查点，或在总控许可的非重叠范围内分给临时协作者。

- [T12 统一事务、草案与撤销历史](#t12)：[T02](02-document-and-persistence-2026-09-19.md#t02)
- [T13 任务命令与基础构造自动编制](#t13)：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)；基础交付还需 [C03 联合签收](04-evaluation-and-operators-2026-09-19.md#c03-interop)，制造签收另需 [T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)
- [T14 Worker 协议与会话求值协调](#t14)：[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)
- [T20 Agent API、兼容投影与能力发现](#t20)：[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)、[T18](02-document-and-persistence-2026-09-19.md#t18)

交付物先做覆盖面的最小验证，再交 P00 接线；同一待验收提交上的全量检查证据可以被多个检查点引用，不重复跑同一批构建。各检查点仍需自己的反例和语义验收。全部小项写完之前，下游可以使用已单独签收的检查点交付。

禁止修改未授权公共文件或其他执行者的工作；需扩范围时给出具体文件、理由、消费者影响，由 P00 登记后执行。

<a id="t12"></a>

## T12 · 统一事务、草案与撤销历史

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T02](02-document-and-persistence-2026-09-19.md#t02)
- 下游：[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)、[T19](02-document-and-persistence-2026-09-19.md#t19)
- 覆盖原工作包：R3
- 验收复核：主代理审查并发/历史语义；保存模块执行者检查订阅边界。

### 目标与代码背景

建立唯一写入入口与快照基线，使 GUI/Agent/手势共享事务，先不接旧 React 状态。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/components/studio/studio-app.tsx](../../src/components/studio/studio-app.tsx)
- [src/lib/source-editor/spline-edit.mjs](../../src/lib/source-editor/spline-edit.mjs)
- [src/lib/creation-commands.mjs](../../src/lib/creation-commands.mjs)

### 可写范围

- src/lib/editing/transaction.mjs（新增）
- src/lib/editing/history.mjs（新增）
- src/lib/editing/dispatcher.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 命令接收 expectedRevision，执行结构与引用范围校验；原子提交不可变 Document，新建/撤销/重做均更新会话令牌。
2. 会话 epoch + 单调 revision + previewId 区分换工程、历史变化与拖动草案；取消草案不会复用旧请求身份。
3. 暂时几何失效可提交；结构非法整批拒绝。记录一条事务及影响集，不在事务外补写输出身份。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A13、A15；U01/U06**；最终标准见架构方案第 10 节。

- [ ] 多动作上色/建部件一次撤销；陈旧 revision 拒绝；拖动更新基于固定基线，Esc/失焦/取消捕获不留历史或文件写。
- [ ] undo/redo 后旧 Worker 结果不可被相同 revision 误接收；切换文件清理 pending context。
- [ ] 原始快照与输入不可变，失败命令不留下部分 ID 或关系。

验证命令：

```sh
node scripts/tests/unit/test-v4-transactions.mjs
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

<a id="t13"></a>

## T13 · 任务命令与基础构造自动编制

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)；基础交付还需 [C03 联合签收](04-evaluation-and-operators-2026-09-19.md#c03-interop)，制造签收另需 [T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)
- 下游：[T16](07-editor-experience-2026-09-19.md#t16)、[T17](07-editor-experience-2026-09-19.md#t17)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)
- 覆盖原工作包：R3/R4/R6
- 验收复核：主代理联合 UI 负责人走查默认任务。

### 目标与代码背景

普通画线、分区、挖洞、上色和重复操作编制同一条 Program，不要求用户手动接线。

本检查点分两次签收，仍由同一包负责：基础签收涵盖画线/分区/孔/上色/毫米厚度/重复、编组和源转移，依赖已列平面与浮雕模块，不等待 T10；T16/T17 可据此开始。制造签收在 T10 完成后补齐分层/Part 分配与其实际结果测试。两次都签收才把 T13 总状态改为完成，API 全能力和 G1/G2 不跳过制造部分。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/creation-commands.mjs](../../src/lib/creation-commands.mjs)
- [src/lib/modifier-commands.mjs](../../src/lib/modifier-commands.mjs)
- [src/lib/creation-path-transfer.mjs](../../src/lib/creation-path-transfer.mjs)
- [src/lib/spline-api.ts](../../src/lib/spline-api.ts)

### 可写范围

- src/lib/editing/commands/（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 轮廓提交维护显式 Source 集合与基础 Fill；辅助线不接入；分区/洞有命名目标，未闭合保留可编辑状态。
2. 上色/厚度、编组、源转移、重复/连接边界、解除关系、制造分层/Part 分配和重建输出等组合命令以一次事务提交。
3. 首次绑定和重建契约在命令草案中取得当前求值候选并校验基线；高级修改后的快捷动作不会重建覆盖整个 Program。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A12、A13、A19–A21；U01/U02/U04/U05**；最终标准见架构方案第 10 节。

- [ ] 新建→闭合→上色→厚度无需技术步骤；展开高级详情前后 Document 不变。
- [ ] 不能定位唯一目标时给范围选择而非猜测；selected 切割不变 all，树整理不成为源转移。
- [ ] 用同一命令覆盖普通与高级流程，确保没有按 roles 动态推导的第二求值路径。
- [ ] 基础签收：提交 / 测试 / 验收人 / 日期待填。
- [ ] 制造签收：T10 提交 / 分层与 Part 实际结果 / 验收人 / 日期待填。

验证命令：

```sh
node scripts/tests/unit/test-v4-authoring.mjs
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

<a id="t14"></a>

## T14 · Worker 协议与会话求值协调

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T12](06-editing-runtime-and-api-2026-09-19.md#t12)
- 下游：[T16](07-editor-experience-2026-09-19.md#t16)、[T19](02-document-and-persistence-2026-09-19.md#t19)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)
- 覆盖原工作包：R3
- 验收复核：主代理审查并发；I00 负责真实 Worker 装配验证。

### 目标与代码背景

将线程通信与编辑会话隔离，接收相同 revision 的阶段结果，禁止求值回写 Document。本检查点签收协议与会话核心；真实 Fill 和 Body 服务分别在 T08/T11 后由 I00 装配验证。T14 核心完成可以供 UI 接线，不能据此宣称实体或 A16 全链已通过。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/model-worker.ts](../../src/lib/model-worker.ts)
- [src/components/creation/creation-workspace.tsx](../../src/components/creation/creation-workspace.tsx)
- [src/types/worker.d.ts](../../src/types/worker.d.ts)
- [vite.desktop.config.ts](../../vite.desktop.config.ts)

### 可写范围

- src/lib/evaluation/worker-protocol.ts（新增）
- src/lib/evaluation/worker-client.ts（新增）
- src/lib/evaluation/session.mjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 请求/响应携带 epoch、revision、previewId、请求域与 requestId；current/pending/failed 状态明确。
2. 客户端按实际依赖调度、取消/丢弃陈旧结果，并公开 inspect 等待当前提交结果的接口；预览不得自动提交。
3. 阶段服务按合同注入；早期只注册已完成平面服务，T11 完成后 I00 注册实体服务。未注册阶段明确 unavailable，不能用占位成功结果。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A09、A13、A16**；最终标准见架构方案第 10 节。

- [ ] 拖动、撤销、切换文件、关闭组件、连续导出、延迟/乱序响应均不污染当前文档或选区。
- [ ] 使用符合合同的当前上游 ready/下游 blocked 状态 fixture 验证传递与保留；后台没有 bindSurfaceGraphs 式写回。真实 Fill 失败显示由 I00/T08 接通验证。
- [ ] 为 I00 提供实际 Worker 接线与冒烟清单；T08 平面服务和 T11 实体服务接入后，I00 必须执行双端构建及真实 Worker 冒烟，并在 G1/G2 补录结果。

验证命令：

```sh
node scripts/tests/unit/test-v4-worker-protocol.mjs
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

<a id="t20"></a>

## T20 · Agent API、兼容投影与能力发现

- 状态：未开始
- 执行者 / 验收者：未分配
- 前置：[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)、[T18](02-document-and-persistence-2026-09-19.md#t18)
- 下游：[T21](01-validation-2026-09-19.md#t21)
- 覆盖原工作包：R3/R8
- 验收复核：主代理审查版本/兼容承诺；验证负责人比较GUI/API。

### 目标与代码背景

API 与 GUI 调用同一命令和同一结果快照；兼容层只转换协议，不再写旧数组。

现有代码入口（用于理解与复用，不自动获得写权限）：

- [src/lib/creation-api.ts](../../src/lib/creation-api.ts)
- [src/lib/spline-api.ts](../../src/lib/spline-api.ts)
- [src/lib/model-api.ts](../../src/lib/model-api.ts)
- [src/lib/tool-schema.ts](../../src/lib/tool-schema.ts)
- [src/hooks/trace-agent-contract.ts](../../src/hooks/trace-agent-contract.ts)
- [scripts/agent-server.mjs](../../scripts/agent-server.mjs)

### 可写范围

- src/lib/api/v4/（新增）
- src/lib/api/legacy-projection.mjs（新增）
- scripts/tests/fixtures/v4-api/（新增）
- scripts/tests/browser/v4/test-api-parity.cjs（新增）

另含下列命令对应的新单测文件。

上述未存在模块均为拟新增路径。本检查点只修改此范围及执行记录；公共接线交 [P00](./00-architecture-and-integration-2026-09-19.md) 的 I00 处理。

### 分步交付

1. 文档V4/API5.0独立版本和能力发现；inspect 返回 epoch/revision/明确单位与实体引用；导出等待当前提交结果。
2. 旧读协议从V4做投影；可保留写操作必须带旧快照 revision 并将索引映射为稳定ID，缺失/过期明确迁移错误。
3. WebMCP/HTTP桥/示例调用者适配清单及补丁交 I00；过时命令不静默换含义。

按交付物提交小改动，不等整包所有检查点做完再一次提交。

### 验收

覆盖：**A06、A13、A16、A19**；最终标准见架构方案第 10 节。

- [ ] GUI和API同一任务得到相同规范化Document/结果；scope、单位、批量失败与撤销一致。
- [ ] 陈旧nodeIndex、旧group语义、原始get_project回写均不能绕过新权威；无revision不默认取当前值。
- [ ] 能力发现与错误格式可验证，不要求客户端通过DOM等候构面。

验证命令：

```sh
node scripts/tests/unit/test-v4-api.mjs
pnpm test:browser --suite v4 --case api-parity --target web
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
