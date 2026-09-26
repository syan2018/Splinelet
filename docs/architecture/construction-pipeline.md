# 构造链与失效处理

更新：2026-09-26。本文记录 V5 的作者数据、修改器求值和修复边界。架构依据为[修改器链、快照与断链修复方案](region-identity-redesign-2026-09-26.md)，实际覆盖范围见[验收记录](../qa/modifier-chain-recovery-2026-09-26.md)。派生面数可以随拓扑变化；属性目标由明确选择声明，失效后交由用户修复。

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

V5 的 OutputRef 保留兼容字段结构：`key` 是 RegionDefinition 的短 ID，`lineage` 为空，owner/operator/port/instances 必须与定义 context 一致。定义区分算子的整结果与由有序来源边界围成的单面；临时 cell 句柄不能保存。默认值和覆盖值分别保存；覆盖缺失的字段继续继承默认。整体 Z 编辑只改变放置，不物化厚度覆盖。

## 编辑、显示与导入边界

`.spl` 中的 V5 Document 是编辑和保存的权威。命令产生新修订，求值后投影为只读 `StudioDisplayProject` 供原工作区使用；展示版本随文档版本，不得断言为旧 V1–V3 Project 后交回旧编译器。像素/世界坐标适配只位于投影与编辑意图边界。

`openProject` 先解码；更早格式经 `importLegacy` 产生明确的 V4 中间文档，再由 `migrateRegionDefinitions` 转换。转换以旧冷求值作为一次性见证，逐算子验证实例、区域数量、孔洞拓扑及数值网格精度内的几何一一对应，然后重写短引用并进行 V5 冷复算。任何缺失、歧义或几何差异均拒绝转换，不打开部分迁移的可写工程。转换成功的文档不绑定旧文件，必须另存；原生 V5 文件正常绑定。旧解释器不会在 V5 求值失败时接管。

迁移报告属于会话，不属于几何或文件 DTO。Studio 显示 warning/error，替换工程时同步替换报告。未发布支撑等无法保持动态关系的旧语义，必须说明已经固定为当前高度以及后续不再联动的影响，不能仅因 schema 通过便静默认为无损。

## 区域身份查询

`src/lib/construction/output-identity.mjs` 是完整身份的共同实现。稳定序列化继续生成既有六字段身份字符串；精确相等直接比较字段，避免在每次查询时重新转义庞大的 key/lineage。对象属性顺序不影响比较，instances 和 lineage 数组仍按既有顺序比较。构造侧仍拒绝缺失引用，展示侧保留空引用诊断读法。

`createOutputRefIndex` 按 ownerNodeId、operatorId、port、key 的原始字符串建立分层索引，再核对完整六字段。索引不使用有碰撞风险的摘要；匹配结果保留源顺序和重复项，消费者继续报告歧义/冲突。selected scope 中的失效引用仍阻断，空选择不会变成全选。

新建分区/布尔等作者命令根据算子明确返回的 parent 引用继承赋值；不以 lineage 子集、几何重叠或最近面猜测父目标。普通源移动只改变曲线，求值不会修改定义或属性。失效定义保留，报告 missing/ambiguous；制造分支不会为失效绑定使用默认属性冒充有效结果。

`src/lib/relief/output-queries.mjs` 汇总外观、浮雕、展示、制造归属和排除索引。一次 document 求值中的浮雕、制造、导出视图共用上下文；每次创作/建模视图投影重新创建上下文。索引和身份 memo 只在输入不变的一次操作中有效，命令草案修改后必须重建，不能跨修订、preview、撤销或换工程保留。它们不进入持久化 DTO 或 Worker 消息。

源 Edge use 保存逻辑 basisSpan；复合路径用 basisCatalog/basisPieces 表达多个来源。拆分、反转、删点拟合、合并和整条路径替换由同步命令显式重参数化。采样线段在 noding、重合边合并、半边图、布尔和边界提取中携带来源，不按几何距离反查来源。

单面定义保存有序来源环、方向、孔洞和交点条件。先用完整拓扑条件表达目标；只有整体条件仍不唯一才增加持久逻辑参数域。自动接边是所声明切割路径的延续，接边段的出现/消失不会单独命名相邻面。真实拓扑变化仍可能令定义失效，系统不自动换面。语言与边界详见[架构决策](region-identity-redesign-2026-09-26.md)。

## 失败范围

后段从既有外观、浮雕和制造作者表编译只读执行计划，节点通过类型化依赖连接 Appearance → Relief → Placement → Cleanup → Body；计划不写入 Program，不另建一份作者模型。逐节点缓存只属于会话，计数不进入公开结果；自定义世界变换和实体选项使用保守缓存边界。当前与历史端口结果分开保存，mesh buffer 经过副本边界，调用者不能污染缓存。

显式 `curve-endpoint-attach` 将有界接边置于分区之前；`region-select` 用作者锚点选择并合并具名结果，属性引用该结果。原边界定义作为兼容的明确选择条件保留，并有手动重选入口；它们不再被宣称能保证任意拓扑编辑后的身份不变。`region-snapshot-source` 仅由用户固化创建，普通失败不触发自动 Bake。

阶段状态为 ready、empty、absent、blocked。relief 和 placedRelief 另带 branches，每个分支携带 ownerNodeId、状态、诊断和当前有效成员。存在阻断分支时，聚合为 blocked 且没有 value。预览可读取其中 ready 分支；实体和导出必须检查聚合完整性，不能使用预览子集作为成品。

浮雕赋值在所属 Shape 范围内解析。一个 Shape 的 Fill 或赋值失败，不清空另一个独立 Shape。作者启用状态独立于求值状态：二维仍可显示区域，无法放置的区域标记 flatOnly，不伪造厚度或复用上一帧实体。

Creation cell 的 evaluation 区分 disabled（未启用浮雕）、excluded（制造排除）、unevaluated（相关阶段未求值）、unplaced（有浮雕定义但无放置成员）、ready 与 blocked。没有浮雕成员本身不代表出错；只有失败的当前分支、赋值或无法唯一解析的成员才标记 blocked。

放置按真实依赖求解：自由放置独立；节点附着等待目标的完整有效加料成员，输出附着使用完整 OutputRef；附着目标失败、跨 Part、缺失或循环会阻断依赖者。打印层基面由前序层顶面确定，前序未知加料使后序放置暂停，同层基面及独立自由放置仍可确定。被制造排除的部件不贡献层高；隐藏只影响视图，不能静默排除制造错误。

当前 BodySet 及导出保守要求全部未排除制造分支完整，包括选择单个 Part 时。只要有未解决阻断便拒绝导出；这避免未知切料/附着使输出缺件，尚不提供隔离 Part 的部分成功导出。

## 编辑、并发与保存

原 Studio host 持有唯一 editor session。GUI 意图、API 5 作者命令、预览、撤销、保存均进入该会话。Worker 求值使用 epoch/revision/previewId 标识；过期结果不接入当前显示。API 的求值请求也调用同一求值器与 Worker，不运行另一套兼容几何。

host 同时持有唯一 document evaluation session。GUI 的区域/实体视图与 Agent 的求值/导出共用请求与完成缓存，缓存键包含 epoch、revision、previewId、previewVersion 和规范化后的阶段集合；相同请求合并，错误请求可重试，编辑或打开新工程使旧结果失效。阶段集合不同的请求分别计算，不把缺少阶段的快照当成完整结果。

点、柄与已选路径的拖动只生成源线展示增量，手势期间不写 editor preview、不触发区域求值，松手一次提交，取消丢弃。交互求值保留一个在途请求和一个最新待处理请求；显式检查/导出的 exact 请求不被预览合并吞掉。平面缓存依据当前依赖和上游 generation；内建纯算子命中时复用冻结 DTO，跨 Shape/关系/变换仍参与失效，custom resolver 保持独立求值边界。

`requestedDomains` 决定实际算子执行范围：按输出域选择算子并回溯真实上游，包含未发布的曲线阶段；曲线依赖区域轮廓时必须保留该区域依赖，不能只过滤最终输出。端点吸附在指针按下时读取当前修订已接受的 Worker 结果；待计算时仍提供源端点，暂不提供过期的派生接缝。

预备底板等候选文档不是当前修订，使用同一后端单独求值，并在返回时检查其基准状态。候选结果不进入当前修订缓存。源线直接显示当前手势增量；派生样条只读取 Worker 已完成的预览，等待时保留最后接受的显示结果。React 渲染不调用求值器，因为曲线也可能依赖区域轮廓，不能把“只请求曲线”当成同步计算廉价的保证。

作品树消费递归 scene tree，Group 可选择、移动、隐藏、锁定、保持世界位置换父级和解组。子 Shape 的源线和区域仍在原树行中。组的路径列表只是用于选区/拖动的后代投影，不转移源所有权。

普通求值的预览状态、失败诊断与派生面几何不写入 .spl；保存作者定义和引用，重开时重新求值。只有用户显式固化快照时，才把选定几何保存为独立 Snapshot Source 的作者输入，并保持断开，等待用户接线。修复或撤销恢复同一链，失败不自动回灌旧面。接口见 [Agent API 5](../agent-api-2026-09-20.md)，复审证据见 [2026-09-20 记录](../qa/v4-refactor-review-2026-09-20.md)。
