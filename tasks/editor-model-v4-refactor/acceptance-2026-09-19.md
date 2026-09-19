# V4 重构验收索引

建档：2026-09-19。**实施中；合同门已签收，代码和用户旅程逐项验证。** 规范标准引用[架构方案第 10 节](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md#10-最终验收矩阵)，不在本页修改标准。

## 阶段签收

| 门槛           | 状态   | 待验收提交 / 合同版本 | 证据与结论                                                       | 验收人 / 日期                       |
| -------------- | ------ | --------------------- | ---------------------------------------------------------------- | ----------------------------------- |
| G0a 合同       | 通过   | ee951b7 / v1          | [五例、引用与字段合同独立走查](contracts-2026-09-19.md#冻结记录) | 主代理与独立合同审阅者 / 2026-09-19 |
| G0b 基线与工具 | 执行中 | 1fc9902 旧产品基线    | 比较器反例与隔离浏览器 runner 正在验收                           | 主代理 / 2026-09-19                 |
| G1 无界面全链  | 实施中 | —                     | —                                                                | —                                   |
| G2 默认体验    | 未开始 | —                     | —                                                                | —                                   |
| G3 全功能试验  | 未开始 | —                     | —                                                                | —                                   |
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
- 隔离账户/VM 中 Tauri 原生文件流程结果：
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

## 实施检查记录 · 2026-09-19

当前模块证据：`test-v4-program-interop.mjs` 使用真实 Document 的 Source → Mirror → Array → Join → Fill，覆盖开放母线、中心孔、pose 移动、重设原点、断缝与空输入；`test-v4-full-pipeline.mjs` 接通区域 → 浮雕 → 制造放置 → Manifold 实体及 SVG/STL/3MF。`test-v4-authoring.mjs` 覆盖普通绘制、显式闭合、首次上色、厚度与重着色、一次撤销、失效区域拒绝和高级程序保护。

本轮 `pnpm check:all` 通过：51 个隔离单元测试、全库类型/lint/格式、Rust format/check、Web 与桌面前端生产构建。此后增量修改仍须按当前提交复验。浏览器旧产品基线仍有 5 项失败，见[基线快照](../../docs/qa/v4-foundation-baseline-2026-09-19.md)；不能把模块测试通过当作 U/A 全部通过。

尚未签收：实际 Worker/UI 装配、完整任务命令与属性界面、真实旧工程导入等价比较、文件/Agent API 接线、双端用户旅程与默认切换。因此 G1 标记实施中，G2–G5 不签收，不以骨架组件或模拟界面测试替代真实旅程。
