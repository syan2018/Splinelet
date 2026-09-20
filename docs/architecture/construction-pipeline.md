# 构造链与失效处理

更新：2026-09-20。本文描述当前 V4 运行链；旧工程经导入边界转换，旧 Project/modifier 数组不再是编辑权威。

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

## 失败范围

阶段状态为 ready、empty、absent、blocked。relief 和 placedRelief 另带 branches，每个分支携带 ownerNodeId、状态、诊断和当前有效成员。存在阻断分支时，聚合为 blocked 且没有 value。预览可读取其中 ready 分支；实体和导出必须检查聚合完整性，不能使用预览子集作为成品。

浮雕赋值在所属 Shape 范围内解析。一个 Shape 的 Fill 或赋值失败，不清空另一个独立 Shape。作者启用状态独立于求值状态：二维仍可显示区域，无法放置的区域标记 flatOnly，不伪造厚度或复用上一帧实体。

放置按真实依赖求解：自由放置独立；节点附着等待目标的完整有效加料成员，输出附着使用完整 OutputRef；附着目标失败、跨 Part、缺失或循环会阻断依赖者。打印层基面由前序层顶面确定，前序未知加料使后序放置暂停，同层基面及独立自由放置仍可确定。被制造排除的部件不贡献层高；隐藏只影响视图，不能静默排除制造错误。

当前 BodySet 及导出保守要求全部未排除制造分支完整，包括选择单个 Part 时。只要有未解决阻断便拒绝导出；这避免未知切料/附着使输出缺件，尚不提供隔离 Part 的部分成功导出。

## 编辑、并发与保存

原 Studio host 持有唯一 editor session。GUI 意图、API 5 作者命令、预览、撤销、保存均进入该会话。Worker 求值使用 epoch/revision/previewId 标识；过期结果不接入当前显示。API 的求值请求也调用同一求值器与 Worker，不运行另一套兼容几何。

作品树消费递归 scene tree，Group 可选择、移动、隐藏、锁定、保持世界位置换父级和解组。子 Shape 的源线和区域仍在原树行中。组的路径列表只是用于选区/拖动的后代投影，不转移源所有权。

预览状态、失败诊断与面几何均不写入 .spl；保存作者定义和引用，重开时重新求值。修复或撤销恢复同一链，不将旧面回灌进文档。接口见 [Agent API 5](../agent-api-2026-09-20.md)，复审证据见 [2026-09-20 记录](../qa/v4-refactor-review-2026-09-20.md)。
