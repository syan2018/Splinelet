# 构造链与失效处理

更新：2026-09-26。本文描述当前 V4 运行链；旧工程经导入边界转换，旧 Project/modifier 数组不再是编辑权威。

## 持久定义与求值结果

场景 Node 分为 Group 和 Shape。Group 持有层级、pose、显示和锁定；Shape 另外拥有局部 Sketch 和 Program。路径 Collection 只保存整理引用。Datum、Parameter、Relation 保存可编辑约束；整体移动修改 pose，不平移每个顶点或把修改器中心固定在世界坐标。

Sketch 的 Vertex、Edge、Path 有稳定身份。Program 的算子显式声明输入端口和发布输出；镜像/阵列产生带实例身份的精确贝塞尔，Join 保存边端对应，Fill 仅消费已连接拓扑。曲线可以开放，构面失败是可保存、可修复的作者态。

| 阶段         | 服务                                                          | 结果与职责                                                   |
| ------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| 曲线、区域   | src/lib/construction/document-evaluation.mjs                  | 局部 CurveSet/RegionSet、算子阶段与发布端口；Fill 才采样成面 |
| 浮雕定义解析 | src/lib/relief/resolve.mjs                                    | 按 OutputRef 解析外观、启用、厚度权威和放置意图              |
| 制造放置     | src/lib/manufacturing/placement.mjs                           | 计算 Part、世界 XY 和 Z；解析层/附着依赖                     |
| 实体         | src/lib/solid/bodies.mjs                                      | 消费完整 PlacedReliefSet，执行实体/材料布尔和网格验证        |
| 预览、导出   | src/lib/editor/creation-view.mjs、src/lib/export/snapshot.mjs | 消费同一求值 DTO，不回写派生几何                             |

OutputRef 的 owner、operator、port、key、instances、lineage 共同参与身份；不能用 key 或数组下标代替。默认值和覆盖值分别保存；覆盖缺失的字段继续继承默认。整体 Z 编辑只改变默认放置和显式放置覆盖，不把厚度覆盖物化为独立放置。

## 区域身份查询

`src/lib/construction/output-identity.mjs` 是完整身份的共同实现。稳定序列化继续生成既有六字段身份字符串；精确相等直接比较字段，避免在每次查询时重新转义庞大的 key/lineage。对象属性顺序不影响比较，instances 和 lineage 数组仍按既有顺序比较。构造侧仍拒绝缺失引用，展示侧保留空引用诊断读法。

`createOutputRefIndex` 按 ownerNodeId、operatorId、port、key 的原始字符串建立分层索引，再核对完整六字段。索引不使用有碰撞风险的摘要；匹配结果保留源顺序和重复项，消费者继续报告歧义/冲突。selected scope 中的失效引用仍阻断，空选择不会变成全选。

分裂/合并的赋值继承先查精确匹配。无精确结果时按 owner 和有序 instances 分组，以父 lineage 的首个 token 缩小候选，再核对完整 lineage 子集并恢复原赋值顺序。多个父赋值不一致仍产生冲突；继承只是提案，不在查询时改写文档。

`src/lib/relief/output-queries.mjs` 汇总外观、浮雕、展示、制造归属和排除索引。一次 document 求值中的浮雕、制造、导出视图共用上下文；每次创作/建模视图投影重新创建上下文。索引和身份 memo 只在输入不变的一次操作中有效，命令草案修改后必须重建，不能跨修订、preview、撤销或换工程保留。它们不进入持久化 DTO 或 Worker 消息。

这一运行时优化不改变 `.spl` 协议、嵌套来源 key 或复制重映射规则，也不改变求值域调度、平面缓存失效条件和取消策略。持久化来源表示压缩需要单独的版本迁移设计。

## 失败范围

阶段状态为 ready、empty、absent、blocked。relief 和 placedRelief 另带 branches，每个分支携带 ownerNodeId、状态、诊断和当前有效成员。存在阻断分支时，聚合为 blocked 且没有 value。预览可读取其中 ready 分支；实体和导出必须检查聚合完整性，不能使用预览子集作为成品。

浮雕赋值在所属 Shape 范围内解析。一个 Shape 的 Fill 或赋值失败，不清空另一个独立 Shape。作者启用状态独立于求值状态：二维仍可显示区域，无法放置的区域标记 flatOnly，不伪造厚度或复用上一帧实体。

Creation cell 的 evaluation 区分 disabled（未启用浮雕）、excluded（制造排除）、unevaluated（相关阶段未求值）、unplaced（有浮雕定义但无放置成员）、ready 与 blocked。没有浮雕成员本身不代表出错；只有失败的当前分支、赋值或无法唯一解析的成员才标记 blocked。

放置按真实依赖求解：自由放置独立；节点附着等待目标的完整有效加料成员，输出附着使用完整 OutputRef；附着目标失败、跨 Part、缺失或循环会阻断依赖者。打印层基面由前序层顶面确定，前序未知加料使后序放置暂停，同层基面及独立自由放置仍可确定。被制造排除的部件不贡献层高；隐藏只影响视图，不能静默排除制造错误。

当前 BodySet 及导出保守要求全部未排除制造分支完整，包括选择单个 Part 时。只要有未解决阻断便拒绝导出；这避免未知切料/附着使输出缺件，尚不提供隔离 Part 的部分成功导出。

## 编辑、并发与保存

原 Studio host 持有唯一 editor session。GUI 意图、API 5 作者命令、预览、撤销、保存均进入该会话。Worker 求值使用 epoch/revision/previewId 标识；过期结果不接入当前显示。API 的求值请求也调用同一求值器与 Worker，不运行另一套兼容几何。

host 同时持有唯一 document evaluation session。GUI 的区域/实体视图与 Agent 的求值/导出共用请求与完成缓存，缓存键包含 epoch、revision、previewId、previewVersion 和规范化后的阶段集合；相同请求合并，错误请求可重试，编辑或打开新工程使旧结果失效。阶段集合不同的请求分别计算，不把缺少阶段的快照当成完整结果。

预备底板等候选文档不是当前修订，使用同一后端单独求值，并在返回时检查其基准状态。候选结果不进入当前修订缓存。拖动中的精确样条辅助预览保留同步轻量求值，不等待曲面/实体 Worker；它不参与成品导出。

作品树消费递归 scene tree，Group 可选择、移动、隐藏、锁定、保持世界位置换父级和解组。子 Shape 的源线和区域仍在原树行中。组的路径列表只是用于选区/拖动的后代投影，不转移源所有权。

预览状态、失败诊断与面几何均不写入 .spl；保存作者定义和引用，重开时重新求值。修复或撤销恢复同一链，不将旧面回灌进文档。接口见 [Agent API 5](../agent-api-2026-09-20.md)，复审证据见 [2026-09-20 记录](../qa/v4-refactor-review-2026-09-20.md)。
