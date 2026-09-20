# V4 重构验收索引

建档：2026-09-19。**默认 V4 与原工作区接入已完成，最终结果见[2026-09-20 收尾快照](../../docs/qa/v4-default-cutover-2026-09-20.md)。** 规范设计标准引用[架构方案第 10 节](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md#10-最终验收矩阵)。用户明确指定以原界面内嵌 Sandrone 正常打开/编辑和 gold 补充工程验收，并允许本机原生验证；本次依据该范围、全库检查和专项回归签收，不冒称原 U/A 全矩阵的每条真实 UI 旅程都已经重跑。

下方门槛、覆盖映射和逐日记录是实施历史；其中“未开始/未验收”保留表示原完整矩阵没有逐项独立签收，不代表仍在运行旧入口。当前事实与最新失败修复以收尾快照为准。

2026-09-20 最终签收：`5c49d0c`，用户指定范围通过。129 单元测试与全量工程检查、原工作区完整浏览器回归、双端生产构建、原生 release 和两份真实 Sandrone 编辑/撤销/副本保存重开均通过。旧文件原件未改变；本轮实现与验证结束。

## 阶段签收

2026-09-19 用户校正：简化 V4 候选界面的运行入口已撤销。下方候选界面历史结果不代表原工作区行为保持，也不计最终产品验收；T16/T17/T22 必须在原 `studio-app.tsx` 界面完成接入。Web 与桌面前端已恢复原入口；这仅是界面恢复，不表示 V4 已接入。具体约束见[总控](README.md#用户校正后的执行边界--2026-09-19)。

| 门槛           | 状态   | 待验收提交 / 合同版本 | 证据与结论                                                       | 验收人 / 日期                       |
| -------------- | ------ | --------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| G0a 合同       | 通过   | ee951b7 / v1          | [五例、引用与字段合同独立走查](contracts-2026-09-19.md#冻结记录) | 主代理与独立合同审阅者 / 2026-09-19 |
| G0b 基线与工具 | 执行中 | 1fc9902 旧产品基线    | 比较器反例与隔离浏览器 runner 正在验收                           | 主代理 / 2026-09-19                 |
| G1 无界面全链  | 实施中 | —                     | —                                                                | —                                   |
| G2 默认体验    | 实施中 | —                     | —                                                                | —                                   |
| G3 全功能试验  | 实施中 | —                     | —                                                                | —                                   |
| G4 候选验收    | 未开始 | —                     | —                                                                | —                                   |
| G5 默认切换后  | 未开始 | —                     | —                                                                | —                                   |

门槛要求见[总控计划](README.md)。G4 与 G5 的结果分开记录，最终切换改变调用路径后必须复验，不能直接把候选提交的 PASS 复制成最终结果。

## 全量覆盖映射

测试名称为计划入口，具体路径、断言和实际输出由对应工作包交付。每一行最终链接 fixture、实际测试命令/人工步骤、提交 hash 和验收报告；“覆盖任务存在”不代表已经验证。

| 项目 | 责任检查点                                                                                                                                                                                                                                                                                                                               | 主要证据类型 / 场景                                             | 门槛     | 状态 / 实际证据 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- | --------------- |
| U01  | [T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T16](07-editor-experience-2026-09-19.md#t16)、[T17](07-editor-experience-2026-09-19.md#t17) | basic-authoring；从新建到上色/厚度/导出，无技术必答步骤         | G2/G4/G5 | 未开始          |
| U02  | [T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T16](07-editor-experience-2026-09-19.md#t16)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                     | basic-authoring、progressive-workspace；分区/孔/局部属性        | G2/G4/G5 | 未开始          |
| U03  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T15](07-editor-experience-2026-09-19.md#t15)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                         | progressive-workspace；编组/移动/解组与制造不变                 | G2/G4/G5 | 未开始          |
| U04  | [T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T16](07-editor-experience-2026-09-19.md#t16)、[T17](07-editor-experience-2026-09-19.md#t17)                     | repeated-motif；母线编辑后返回普通属性                          | G4/G5    | 未开始          |
| U05  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                          | reference-space；两种引用意图与来源移动断言                     | G4/G5    | 未开始          |
| U06  | [T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)、[T17](07-editor-experience-2026-09-19.md#t17)、[T19](02-document-and-persistence-2026-09-19.md#t19)                                                                            | failure-repair-reopen；保留选择上下文及折叠详情                 | G4/G5    | 未开始          |
| A01  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T16](07-editor-experience-2026-09-19.md#t16)                                                                                                                                                                                                                                     | scene + object-move；pose 改变、局部定义不变                    | G1/G2/G5 | 未开始          |
| A02  | [T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T16](07-editor-experience-2026-09-19.md#t16)                                                                                                                                                                                | 曲线/区域整合 + object-move；重复后整体移动并继续编辑           | G2/G4/G5 | 未开始          |
| A03  | [T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T16](07-editor-experience-2026-09-19.md#t16)                                                                                                                                                                                | 禁用/移动/再启用；中心与形状正确                                | G2/G4/G5 | 未开始          |
| A04  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                                                                        | scene/manufacturing + progressive-workspace；keepWorld/选择去重 | G2/G4/G5 | 未开始          |
| A05  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                                                                               | evaluation + 两种引用旅程；循环与父组变换                       | G1/G4/G5 | 未开始          |
| A06  | [T02](02-document-and-persistence-2026-09-19.md#t02)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)                                                                                                                                                                         | sketch/api；节点拆删、稳定 ID、陈旧索引拒绝                     | G1/G4/G5 | 未开始          |
| A07  | [T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                                                                               | relations + 接缝旅程；共享中心/方向/允许的重复参数              | G1/G4/G5 | 未开始          |
| A08  | [T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T05](03-scene-and-source-geometry-2026-09-19.md#t05)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T16](07-editor-experience-2026-09-19.md#t16)                                                                                                                        | sketch/relations + 派生柄真实拖动                               | G1/G4/G5 | 未开始          |
| A09  | [T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T15](07-editor-experience-2026-09-19.md#t15)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                            | evaluation/provenance/worker + 失败修复旅程                     | G1/G4/G5 | 未开始          |
| A10  | [T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T18](02-document-and-persistence-2026-09-19.md#t18)                                                                                                                                                                  | provenance/relief/migration；拓扑变化与歧义赋值                 | G1/G4/G5 | 未开始          |
| A11  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T16](07-editor-experience-2026-09-19.md#t16)                                                                                                                                                                               | 纯引用 fixture；无源线仍可选中/移动                             | G2/G4/G5 | 未开始          |
| A12  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T04](03-scene-and-source-geometry-2026-09-19.md#t04)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                         | scene/sketch/authoring + 树整理与源转移区分                     | G2/G4/G5 | 未开始          |
| A13  | [T12](06-editing-runtime-and-api-2026-09-19.md#t12)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T19](02-document-and-persistence-2026-09-19.md#t19)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)                                                                 | transactions/worker/api + pointer/restore races                 | G1/G4/G5 | 未开始          |
| A14  | [T01](01-validation-2026-09-19.md#t01)、[T18](02-document-and-persistence-2026-09-19.md#t18)                                                                                                                                                                                                                                             | 全版本迁移 manifest、旧成功/失败结果与报告                      | G3/G4/G5 | 未开始          |
| A15  | [T02](02-document-and-persistence-2026-09-19.md#t02)、[T19](02-document-and-persistence-2026-09-19.md#t19)                                                                                                                                                                                                                               | codec/persistence + saving-recovery + 原生文件烟测              | G3/G4/G5 | 未开始          |
| A16  | [T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T14](06-editing-runtime-and-api-2026-09-19.md#t14)、[T20](06-editing-runtime-and-api-2026-09-19.md#t20)                                                                                                       | export/3MF/Bambu/源 SVG/Blender；同 revision 和单位             | G1/G4/G5 | 未开始          |
| A17  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T15](07-editor-experience-2026-09-19.md#t15)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                                                                                                                                      | projection + 锁定/隐藏/筛选/F 定位真实交互                      | G2/G4/G5 | 未开始          |
| A18  | [T02](02-document-and-persistence-2026-09-19.md#t02)、[T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T15](07-editor-experience-2026-09-19.md#t15)                                                                                                                         | 同一 Shape 从空到多结果再到失败，ID/归属不变                    | G1/G4/G5 | 未开始          |
| A19  | [T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T07](04-evaluation-and-operators-2026-09-19.md#t07)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T18](02-document-and-persistence-2026-09-19.md#t18)                                                              | 算子合同/authoring/migration；同域无第二隐式链                  | G1/G4/G5 | 未开始          |
| A20  | [T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T13](06-editing-runtime-and-api-2026-09-19.md#t13)、[T15](07-editor-experience-2026-09-19.md#t15)、[T16](07-editor-experience-2026-09-19.md#t16)、[T17](07-editor-experience-2026-09-19.md#t17)                                                                            | 投影/写回/高级展开；候选面不重复列树                            | G2/G4/G5 | 未开始          |
| A21  | [T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T09](05-relief-manufacturing-and-export-2026-09-19.md#t09)、[T10](05-relief-manufacturing-and-export-2026-09-19.md#t10)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)、[T18](02-document-and-persistence-2026-09-19.md#t18)                                        | selected-target/逐输出高度/Part 的多域比较                      | G1/G4/G5 | 未开始          |
| A22  | [T03](03-scene-and-source-geometry-2026-09-19.md#t03)、[T06](04-evaluation-and-operators-2026-09-19.md#t06)                                                                                                                                                                                                                              | 重设原点及入向 local-result 的实际求值整合                      | G1/G4/G5 | 未开始          |
| A23  | [T06](04-evaluation-and-operators-2026-09-19.md#t06)、[T08](04-evaluation-and-operators-2026-09-19.md#t08)、[T11](05-relief-manufacturing-and-export-2026-09-19.md#t11)                                                                                                                                                                  | 测试注册新算子与消费适配，无 UI 或来源分类修改                  | G1/G4/G5 | 未开始          |

## 每次运行的记录

- 待验收提交 / 工作区差异 / 合同版本：
- 平台、Node/pnpm、浏览器或原生运行环境：
- fixture manifest/hash：
- 最小测试 / 全量检查命令及退出码：
- C03 联合签收 / T13 基础与制造签收 / I00 实际 Worker 接通证据：
- Web 生产构建浏览器旅程结果：
- 桌面前端生产构建浏览器旅程结果：
- 本机专用 Tauri 进程中 Sandrone 打开、编辑、撤销、临时副本保存与重开结果：
- 几何比较阈值版本、差异与结论：
- 冷/热求值和交互延迟、基线与预算：
- 默认流程是否打开技术详情，以及原因：
- 失败 / 未执行 / 阻塞项与对应问题：
- 本地产物路径 / 正式 QA 报告：

本地产物使用 `outputs/v4-qa/<run-id>/`，可重复 fixture 提交到 `scripts/tests/fixtures/`。完成验收时新建使用实际日期的 `docs/qa/editor-model-v4-acceptance-<日期>.md` 并链接，不能预先伪造通过记录。

## 最终签收

- 全部 U01–U06 / A01–A23：未验收
- T00–T22 / I00：未验收
- G5 最终提交：
- 当前文档 / API / 运行行为一致性：
- 旧写路径退出清单与剩余 import/math/test 引用说明：
- 原 V1–V3 文件保护 / V4 原件与报告保留：
- 验收人 / 日期 / 结论：

任何未完成的必需项不能写成“通过，后续优化”。需要改范围时先更新方案、合同与受影响工作包，经明确评审后重新验收。

## 当前原工作区增量证据 · 2026-09-20

以下是本轮在原 `StudioApp` 与 V4 host 的实际浏览器证据。它更新实施事实，**不改变**上表的最终 U/A 签收状态；没有逐条 fixture、断言和最终切换提交的项目仍不能写成通过。

- `outputs/v4-qa/original-model-panel-viewport-2026-09-20.log`：内置 Sandrone 的原高级建模面板读取规范工作区，确认 69 个区域和 69 个体块可见；禁用厚度后撤销恢复，并由 Worker 验证有效 Body。日志结论为 PASS。
- 该面板的 V4 写回现只签收 `relief` 属性变化：稳定区域 OutputRef 上的启用、厚度、模式和放置，经 `model-workspace-view`、`model-panel-adapter` 与 `createModelIntent` 一次事务写入 `DocumentV4`。它不是旧 `Project.model` 的反向写入。
- 尚未接入、因而仍阻断高级面板全旅程的操作：规范区域构造预览/确认与重绑、一个区域的多个独立浮雕贡献、区域名/显示/标记色、创建/重命名/删除制造零件与替换重绑、级联删除，以及旧模型几何精度和制造清理字段。这些旧写路径在带 V4 runtime 时不得绕过唯一 Document 权威。
- 同目录的 `original-model-panel-2026-09-20.log` 记录了先前 checkbox 取消操作未改变状态的失败；它不是通过证据，后续回归必须以最新的 PASS 日志和独立断言为准。

可直接复用的规范命令边界：区域分区/挖洞为 `createRegionCommand`，路径角色与精确成员切换为 `createPathRolesCommand` / `createRegionPathMembershipCommand`，独立区域追加走 `append-boundary` / `region-collect`；制造零件资源走 `createResourceCommand`，区域 Part 重绑走 `createAdvancedCommand({ kind: 'set-manufacturing-part' })`。这些模块本身不等于相应原 UI 操作已接线或验收。

## 实施检查记录 · 2026-09-19

原工作区适配阶段后续复验：67 单元测试与 `check:all` 通过，两份 Sandrone 初始区域及容器往返通过；共享源、路径组、smooth 编辑语义及原 UI 后端接线仍未签收。具体边界见[阶段快照](../../docs/qa/v4-original-workspace-adapters-2026-09-19.md)，不能沿用候选简化界面的历史通过结果代替。

当前模块证据：`test-v4-program-interop.mjs` 使用真实 Document 的 Source → Mirror → Array → Join → Fill，覆盖开放母线、中心孔、pose 移动、重设原点、断缝与空输入；`test-v4-full-pipeline.mjs` 接通区域 → 浮雕 → 制造放置 → Manifold 实体及 SVG/STL/3MF。`test-v4-authoring.mjs` 覆盖普通绘制、显式闭合、首次上色、厚度与重着色、一次撤销、失效区域拒绝和高级程序保护。

本轮 `pnpm check:all` 通过：51 个隔离单元测试、全库类型/lint/格式、Rust format/check、Web 与桌面前端生产构建。此后增量修改仍须按当前提交复验。浏览器旧产品基线仍有 5 项失败，见[基线快照](../../docs/qa/v4-foundation-baseline-2026-09-19.md)；不能把模块测试通过当作 U/A 全部通过。

尚未签收：实际 Worker/UI 装配、完整任务命令与属性界面、真实旧工程导入等价比较、文件/Agent API 接线、双端用户旅程与默认切换。因此 G1 标记实施中，G2–G5 不签收，不以骨架组件或模拟界面测试替代真实旅程。

## 候选基本旅程 · 2026-09-19

方向校正：以下候选界面已撤出生产入口，其历史通过结果不作为原 UI 保持或 V4 默认切换的签收依据。当前进展与原界面复验见[原工作区恢复快照](../../docs/qa/studio-ui-restoration-2026-09-19.md)和 [P07 接入合同](07-editor-experience-2026-09-19.md#当前接入合同)。

I00 已接通 `document-worker.ts?worker` 与 Manifold wasm、T12/T13 命令、T15 投影、独立恢复草稿和候选 API 5.0。Web/桌面前端四项真实浏览器旅程通过，见[带日期 QA 快照](../../docs/qa/v4-candidate-basic-journeys-2026-09-19.md)。这不是原生宿主验收，不签收全部 G2/G3/G4/G5；未完成项在快照中逐项列明。

## 默认入口和旧路径切断 · 2026-09-20

- 默认 Web/Tauri 均先建立 V4 host，再挂载原 Studio；初始化失败不回退旧工作区。旧可写 Project、旧持久化和旧 Model Worker 入口已移除。
- 原工作区完整浏览器回归：`outputs/v4-qa/original-v4-only-final-2026-09-20.log` PASS，包含原样式、Sandrone 编辑、撤销、保存重开，以及真实高级面板的区域/浮雕/有效 BodySet。前两次运行被 Vite Optimize Dep 504 中断；独立缓存和显式 fixture 扫描后通过，不把中断记录作为验收证据。
- 实际原生默认入口及两份真实工程：`outputs/v4-qa/native-default-entry-2026-09-20T02-11-40.105Z-62312/manifest.json` PASS。每份项目验证节点控制柄编辑、撤销、再次编辑、导出 V4 副本并通过原生打开事件重开。挤出设置检查是导出偏好，不冒充浮雕厚度验收。两个原件 byte-compare 均不变。
- `outputs/v4-qa/check-all-v4-only-complete-2026-09-20.log` 的完整 `pnpm check:all` 退出码为 0：126 项隔离单元测试、类型/lint/格式、Rust format/check、Web 与桌面前端生产构建通过。`release-v4-only-final-2026-09-20.log` 原生 release 构建通过。后续行为恢复与局部审阅修复需各自记录验证，不能套用此快照。
- 这签收“默认 V4、旧路径不可回退、指定真实工程可编辑”范围，不代表 U/A 表所有高级行为已经完成；未恢复项集中记录在总控当前状态中，goal 继续保持 active。

后续行为恢复复验发现：旧 Sandrone 文件含 `manufacturingMM:0.02`，此前导入未保留，因此上面的 BodySet 证据不能代表带制造清理的等价结果。保留该设置后，`original-v4-restored-behaviors-2026-09-20.log` 在实体检查的 120 秒超时失败；该失败必须由制造清理修复和新的真实样例通过记录替代，不能沿用先前 PASS。
