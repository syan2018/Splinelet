# V4 实施合同 v1.1

日期：2026-09-19。状态：**v1 已冻结；v1.1 补充运行时访问器与几何交接细节**。设计依据为[架构方案](../../docs/architecture/editor-model-review-and-refactor-2026-09-19.md)；此处固定实现字段、服务边界与反例。变更须增加版本记录并重验消费者，不能用读取时 normalization 修补不一致。v1.1 不改变 DocumentV4 持久字段；变更及消费者验收见文末。

## C01 · 唯一持久文档

文档字段固定为 `version:4`、`id`、`units:'mm'`、`nodes`、`sketches`、`datums`、`parameters`、`relations`、`programs`、`geometrySettings`、`appearances`、`reliefDefinitions`、`manufacturing`、`assets`、`references`、`collections`。所有实体表为 ID→记录的普通对象，记录含同值 `id`；ID 非空、全工程唯一，数组仅表达次序/操作数集合。持久类型由 `src/lib/document/types.ts` 独占；工厂返回完整新文档，validator 只检查、不填字段/修引用。

- Node 基础字段：`id,name,parentId,order,pose,visible,locked`。`pose={translationMM:[x,y],rotationRad}`；`parentId` 为 Group ID 或 null；`order` 为有限数，同序以 ID 稳定排序。Group 为 `kind:'group'`；Shape 为 `kind:'shape',programId`。不能将 Group 作为 Program/Sketch 的 owner。
- Program 为 `{id,ownerNodeId,operators,outputs}`；operators 是 ID→Operator 表，outputs 是具名 PortRef 映射，首版只发布 `curves`/`regions`。Shape 与 Program 反向引用一一对应；每份 Sketch 有一个 Shape owner。空 Shape 也有空 Program，outputs 可为空。
- Sketch 为 `{id,ownerNodeId,vertices,edges,paths}`；实体细节见 C02。源线不重复保存在全局 paths/derived features。Datum/Parameter 的 `ownerNodeId` 是 Node ID 或 null（工程框架）。Collection 为 `{id,name,members:EntityRef[],origin:'legacy'|'user'}`，只引用、不改变父链或所有权；首版不默认提供集合管理器。
- EntityRef 有明确类型：Node/Datum/Parameter/Relation/Program 使用 `{kind,id}`；Path/Vertex/Edge 使用 `{kind,sketchId,id}`；EdgeEnd 使用 `{kind:'edge-end',sketchId,edgeId,end:'start'|'end'}`；区域使用 C03 OutputRef。记录里不能用数组索引代替实体。
- 类型别名固定：`NodeRef={kind:'node',id}`、`VertexRef={kind:'vertex',sketchId,id}`、`EdgeRef={kind:'edge',sketchId,id}`、`EdgeEndRef={kind:'edge-end',sketchId,edgeId,end:'start'|'end'}`；`TargetRef=NodeRef|OutputRef`。制造/外观/浮雕的 NodeRef 只能指 Shape，禁止 Group；删除影响查询等通用 EntityRef 可指 Group。
- geometrySettings 为 `{curveToleranceMM:0.015,joinToleranceMM:0.001,numericTolerance:1e-9}`。前两项采用当前平面/构面默认值；后者用于浮点比较而非焊接。各值持久化且为正有限数，迁移保持旧有效容差。屏幕吸附像素阈值属于会话，不写入此表。
- 非有限数、类型非法、非法父链/owner、重复 ID、Shape/Program 双向矛盾是结构错误；缺少构造输入、未知算子、输出失效、关系或制造依赖环可保存并诊断。关键所有权引用必须存在；其他构造引用目标已存在但类型不符应拒绝，目标缺失则保留 unresolved。删除必须保留可修复引用，不能转到同索引新实体。
- 禁止持久化世界矩阵、解算后点坐标、派生曲线/面/网格、诊断缓存、选区、文件句柄、epoch/revision 或草案。所有字段必须是有限、无循环的 JSON；拒绝危险对象键和未声明顶层字段，防止把旧模型偷偷塞进 V4。

纯接口：`createDocument(options?) -> DocumentV4`；`validateDocument(value) -> DocumentV4`（验证成功返回输入，不改写）；`inspectDocumentReferences(document) -> Diagnostic[]`（保留结构合法但失效的引用）。工厂生成 ID/默认资源，求值与 validator 不生成 ID。

## C02 · Sketch、参数与有限关系

统一 Vec2 为 `[number,number]`，Affine2D 为 `[a,b,c,d,e,f]`，作用是 `[a*x+c*y+e,b*x+d*y+f]`。旧 `{x,y}` Cubic 只在既有数学内核适配处转换。

```ts
Vertex = { id, position: { kind: 'free', value: Vec2 } | { kind: 'relation', relationId } };
Handle = { kind: 'free', vector: Vec2 } | { kind: 'relation', relationId };
Edge = { id, startVertexId, endVertexId, startHandle: Handle, endHandle: Handle };
Path = { id, name, edges: { edgeId, reversed: boolean }[], visible: boolean };
Parameter = { id, name, ownerNodeId, unit: 'mm'|'rad'|'count'|'unitless', value: number };
Scalar = number | { kind: 'parameter', id } |
  { kind: 'expression', op: 'add'|'subtract'|'multiply'|'divide'|'negate'|'sin'|'cos', args: Scalar[] };
PointRef = { kind: 'vertex', sketchId, id } | { kind: 'datum', id };
Datum = { id, name, ownerNodeId, kind: 'point', position: [Scalar,Scalar] } |
  { id, name, ownerNodeId, kind: 'axis', origin: [Scalar,Scalar], angleRad: Scalar };
```

路径中反向 use 交换边端及柄，不改变源边。首尾连通由顶点 ID 表达，不存第二个 `closed/start/anchors`。相邻 use 顶点不一致为可诊断开放/不连续路径，不自动焊接；删除留下悬空 use 时可诊断，显式删除边命令可同时更新该路径。单独顶点与零边路径允许存在。

首版 Relation 白名单：

| kind                | 字段/自由量                                                                      | 输出与写回                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `point-on-axis`     | `id,target:VertexRef,axisId,distance:Scalar,frame:RelationFrame`                 | 在基准源框架从轴原点沿方向解算后映射到 target owner；拖动只改 distance 所属自由量                                      |
| `coincident`        | `id,target:VertexRef,source:PointRef,offset:[Scalar,Scalar],frame:RelationFrame` | 在引用点源框架加偏移后映射到 target owner；零偏移为重合，拖动改偏移或显式解绑定                                        |
| `handle-continuity` | `id,target:EdgeEndRef,source:EdgeEndRef,mode,length?:Scalar`                     | mode 为 smooth/symmetric/auto；smooth 与源柄反向且使用独立 length，symmetric 等长反向，auto 使用两条边另一端点计算切向 |

Vertex/Handle 的 relationId 必须与 Relation.target 一致；同一目标不能有第二个关系或自由坐标。smooth 的 length 必填，symmetric/auto 不保存多余长度。auto 只处理明确两条相邻边，不将分叉顶点假设成统一左右柄。解除关系是事务：取本次解算值变为 free 并移除关系，可撤销；Alt 只关闭临时吸附。

auto 的方向与长度固定为：共享顶点 V、source 另一端 S、target 另一端 T，target 柄向量为 `normalize(T-S) * |T-V|/3`；零方向 blocked，不读取 source 或自身派生柄。smooth 为 `-normalize(sourceHandle)*length`，symmetric 为 `-sourceHandle`。

`RelationFrame={space:'owner-local'|'world',transform:Affine2D}` 必须显式持久化，transform 限制为 XY 刚性变换。owner-local 使用 transform×源局部值；world 使用 transform×inverse(targetOwnerWorld)×sourceOwnerWorld×源局部值（工程 owner 的世界矩阵为 identity）。distance/offset 在映射前计算，因此仍是源毫米单位。创建命令对同 owner 使用 owner-local/identity，对跨 owner 的可见基准绑定默认 world/identity；需要形状关联时才明确使用 owner-local 输入框架。world 引用将两侧世界矩阵列入依赖，owner-local 不因两侧 pose 改变而失效。handle-continuity 的两个 EdgeEnd 必须属于同一 Sketch 且共享被约束端点，不跨 owner。

Scalar 是固定白名单 AST，限制深度/节点数；不能执行代码。sin/cos 输入弧度；count 为正整数（阵列上限由算子声明）。零除、悬空参数、零方向或实际依赖环为 blocked，不能拿 0 继续。编辑共享 Parameter 需明确影响全部使用者；不修改解算缓存。

纯接口：`resolveSketch(document,sketchId,context?) -> StageResult<CurveSet>`；`editSketch(document,edit) -> {document,changedRefs,removedRefs}`；`resolveDatum/resolveRelation` 使用同一组件依赖上下文。源转移返回闭包/坐标转换和引用影响计划，由事务提交。

## C03 · Program、端口、身份与算子

```ts
PortRef = { kind: 'port', ownerNodeId, operatorId, port: string, domain: 'curves'|'regions' };
InputRef = { kind: 'sketch', sketchId, pathIds?: string[] } |
  { ...PortRef, space: 'local-result'|'world-result', transform: Affine2D };
OutputRef = { kind: 'output', ownerNodeId, operatorId, port, key: string,
  lineage: string[], instances: { operatorId, index: number }[] };
Operator = { id, type: string, name, enabled: boolean,
  inputs: Record<string,InputRef[]>, params: JsonObject,
  outputContract?: { version: 1, members: { port, key, lineage: string[], topology?: string }[] } };
```

Sketch InputRef 只能引用接收 Program 所有者的 Sketch，无额外变换；跨 Shape 一律引用已发布 PortRef。Port 输入的 transform 始终存在，默认 identity；接收者局部坐标下：local-result 使用 transform×来源局部结果，world-result 使用 transform×inverse(receiverWorld)×sourceWorld×来源局部结果。算子只消费显式 inputs；源线的用途仅由任务命令确定如何接入，不在求值时扫角色重建图。outputContract 的 `(operatorId,port,key)` 唯一，成员 port 必须属于该算子的输出，不能跨端口误绑。

算子注册规格固定 `type,inputPorts,outputPorts,validateParams,dependencies,evaluate,bypass?,rebase?`；inputPorts 含域与基数。未知 type 保留原始 JSON 参数但 blocked；已知类型参数非法也诊断，不能隐式旁路。停用只能按已声明的同域 bypass 映射；曲线→区域 Fill 停用没有合法旁路，明确缺少输出。

首版注册类型：`source,curve-reference,region-reference,curve-transform,curve-mirror,curve-array,join,fill,path,stroke,between,partition,boolean,offset,region-array`。T07 拥有 source/curve-*/join，T08 拥有其余及唯一 Fill 转换。`curve-reference` 的具名输入 `input` 接收一个 curves PortRef，发布 `curves`；`region-reference` 同理接收 regions 并发布 `regions`，只应用输入框架不重建几何，因此纯引用 Shape 有可实例化的首算子。已有 region/source/object 栈由 importer 编为明确子链，不新增特殊来源分派。具体参数表在注册实现同类型校验器中唯一维护，T00 规定几何语义，注册实现不得改域或坐标含义。

- Source 明确 pathIds；源 SVG 读取 Source 阶段，不误用最后曲线端口。curve-mirror/array 使用 `center:[Scalar,Scalar]`、`angleRad:Scalar`、array `count:Scalar`；可通过 Parameter 引用共享值。
- Join 的连接使用源 EdgeEndRef 加实例选择器（`{operatorId,index:number|'each'|'next'|'previous',wrap:boolean}`）；each 的迭代变量由同一 array 决定，next/previous 相对于它且 wrap 按实际 count。不以屏幕距离建连接；接缝位置超过 joinToleranceMM 时诊断，不自动伸长/补线。
- Fill 的 `rule:'even-odd'|'non-zero'` 明确，消费闭合连接拓扑；显式补边才产生新源/算子边。Path 是兼容来源 recipe 的适配，仍调用同一 Fill。
- 区域算子 selected scope 为 `{kind:'selected',refs:OutputRef[]}`，all 为 `{kind:'all'}`；空 selected 是空作用范围，失效 selected 为 blocked，绝不自动 all。汇集多个输入只是集合，不隐式 union。
- OutputRef.key 由可解释来源/算子/实例及输出契约产生，不能用当前面数组索引或面积/坐标猜持久身份。split 有明确子 lineage，merge 有多父 lineage；不唯一时产生候选冲突，保留原赋值 unresolved。首次/重建契约只由命令草案求值后绑定，纯求值只返回候选。

StageResult 为 `{domain,status:'ready'|'empty'|'absent'|'blocked',value,diagnostics,dependencies}`。ready 有有效非空结果，empty 有合法空集合，absent 表示未请求/未发布此域，blocked 无可用本阶段值；不使用 null 混淆四类状态。缺少服务另标 `unavailable`（会话能力），不能视为已完成空几何。

运行时 CurveSet 为 `{frame:{kind:'local',ownerNodeId},curves:[{key,pathRef,edges:[{key,cubic:[Vec2,Vec2,Vec2,Vec2],startKey,endKey,source:EdgeRef,instances,transform}],closed}],junctions,provenance}`。closed 只为本次派生信息；RegionSet 为同框架 `{regions:[{ref:OutputRef,geometry:GeoJSON Polygon|MultiPolygon}],provenance}`。JSTS/Manifold 实例不跨 Worker 传递，传可结构化克隆的结果 DTO。

`evaluateProgram(document,nodeId,registry,context?) -> ShapeResult` 包含各已求值端口及发布结果。依赖键以 `node:<id>:world`、`sketch:<id>`、`datum:<id>`、`parameter:<id>`、`relation:<id>`、`operator:<id>:<port>`、`manufacturing:<id>` 区分；实际依赖才成边，不把整个对象压成单点。

## C04 · 场景与坐标

`worldMatrix(document,nodeId)` 沿 Group 父链组合；`reparentNodes(...,{keepWorld:true})` 先去掉被选祖先已覆盖的后代，再用新父逆矩阵求 pose。父链环结构上拒绝，visible/locked 沿父链组合，制造另算。组/解组不写 Sketch、Program 或制造。

重设原点是坐标重表达，不是普通移动：先列本地源/Datum/参数与所有入向 local-result 引用的补偿计划，再一次事务提交。算子参数中的位置/方向由注册 `rebase` 访问器提供，未知类型无法安全重表达时命令拒绝并说明；不能只改已知中心字段留下其他引用。world-result 通过新框架自然重算，local-result 输入 transform 要补偿来源框架变化。

普通复制生成全闭包新 ID，内部实体/端口/赋值/组内跨对象引用通过同一 idMap 重挂，外部引用保留。删除与源转移先返回影响计划；跨 owner 不共享可写 Vertex。

## C05 · 外观、浮雕、制造与实体

`appearances={swatches,defaults,overrides}`：swatches 为 `{id,name,color}` 表；defaults 为 Shape ID→`{swatchId}`；overrides 为 Assignment ID→`{id,target:OutputRef,value:{swatchId}}`。颜色首版 `#rrggbb`，旧色值在 importer 显式转换。单一目标不可有重复有效覆盖。

`reliefDefinitions={defaults,overrides}`：defaults 为 Shape ID→完整 ReliefValue，overrides 为 ID→`{id,target:OutputRef,value:Partial<ReliefValue>}`。ReliefValue 为 `{enabled,thickness,mode,placement}`；thickness 为 `{kind:'mm',value}` 或 `{kind:'layers',count}`，mode 为 `add|cut|through`；placement 为 `{kind:'free',zMM}`、`{kind:'attached',target:NodeRef|OutputRef,offsetMM}` 或 `{kind:'layer',layerId,offsetMM}`。部件默认 fallback 后再局部逐字段覆盖，没上色的新区域默认 enabled=false；首次上色事务同时启用该区域，默认毫米厚度 1。无独立的 effectiveHeightMM 持久值。

`manufacturing={layerHeightMM,layers,layerOrder,parts,defaultPartId,assignments,excluded,slicerTemplate}`。layerHeightMM 默认 0.2；layers 为 `{id,name}` 表，layerOrder 指定顺序。parts 为 `{id,name}` 表，工厂创建默认零件但普通 UI 不要求配置；assignments 为 `{id,target:NodeRef|OutputRef,partId}` 表，逐输出优先于部件、最后 defaultPartId；excluded 为明确 TargetRef 集合；slicerTemplate 沿用现有 Bambu 设置的有限 JSON 资源。Group 不能作为制造赋值目标，组批量操作先展开叶 Shape。

纯接口：`resolveRelief(document,regionResults) -> StageResult<ReliefSet>`；`resolveManufacturing(document,reliefResults,worldMatrices) -> StageResult<PlacedReliefSet>`；`buildBodies(placedResults,kernel) -> Promise<StageResult<BodySet>>`。前者保留厚度/放置意图；后者先换算毫米厚度，再按层/依附求 Z，整数层数不重舍入；Body 按 Part 执行 add/cut/through 并保留材料体积。忽略隐藏与锁定，只看有效成品参与/排除。

每个结果成员保留 OutputRef；Contour 数据可共享，不逐层复制大几何。ReliefSet 携带有效颜色/意图；PlacedReliefSet 携带世界轮廓、厚度毫米、底面/顶面、Part；BodySet 携带可克隆网格、材料体积、来源和诊断。`exportSnapshot(snapshot,{format,stage})` 只消费同一 revision 的指定阶段；源 SVG 保留源 cubic，分色 SVG 消费赋色区域，3MF/STL 消费 Body，Blender 分别取源与实体。下载由平台适配完成。

## C06 · 求值、Worker 与会话

Document 与 EvalSnapshot 分离。Snapshot 标识 `{epoch,revision,previewId}`；提交快照 previewId=null，草案使用唯一 previewId。Worker 请求/响应另外携带 requestId 和 domains；旧 epoch、旧 revision 或已取消 previewId 的消息丢弃。新建/打开更换 epoch，提交/undo/redo 的 revision 严格单调；恢复旧 Document 不回退 revision。

同一个拖动手势的 previewId 保持不变；EditorSession 的 `preview.version` 每次成功 updatePreview 递增。EvaluationSession 为预览结果附带请求捕获的 `previewVersion`，原工作区投影须与当前 `preview.version` 完全匹配。requestId 配对负责拒绝旧 Worker 请求，previewVersion 另外防止调用方保留的较早完成结果被误用；这些字段都不持久化。

`evaluateDocument(document,{registry,services,cache,requestedDomains})` 纯读取文档；cache 以输入依赖值/版本作为键，不能只用数组位置。只有 pose 改变且无 world 输入时复用局部结果；接收者 world 输入变更必须失效。平面失败仍在当前 snapshot 中提供有效上游曲线，禁止显示上次成功面冒充完成。

`createEvaluationSession({evaluate,workerClient})` 处理 pending/current/failed 与 awaitCommittedSnapshot；导出等待指定已提交 revision，用户继续编辑不会把旧异步结果标为当前。T14 先测试协议；I00 后接真实 Fill/Body 并做双端 Worker 验证。

## C07 · 事务、任务与视图

`createEditorSession(document,{epoch?,idFactory?})` 提供只读 state、`dispatch(command,{expectedRevision})`、`beginPreview/updatePreview/commitPreview/cancelPreview`、`undo/redo`、`replaceDocument` 和订阅。命令返回 `{document,changedRefs,selectionIntent?}`；dispatcher 做结构校验，整批原子提交。异步准备命令绑定候选时必须带基准 revision 并重验，不能调后台 bind 写回。

手势从固定 baseline 生成草案，不基于上次鼠标帧累加；释放一次提交，Esc/失焦/取消捕获丢弃全部草案且不写文件。求值失效可提交供修复，结构非法整批拒绝；重复提交无变化不增加历史。

任务命令包括 createShape、draw/closePath、partition、cutHole、paint、setThickness、group/ungroup、moveNodes、editVertices/editHandles、repeat/connectBoundaries、referenceShape/cutAtPlacement，以及按需制造命令。画轮廓提交创建/维护同一 Program，首次闭合接 Fill；辅助线仅留源；高级程序修改后快捷操作只改明确目标，无法定位时请求范围，不覆盖整图。

`projectEditor(document,snapshot,sessionView)` 输出部件树、按需线/区、诊断、有效属性、bounds 与编辑能力。节点身份来自文档，区域来自当前结果。Selection 为 `{scope,entityRefs,activeRef}`；内部选择可以保留 unresolved 目标，不能按新 cells 索引重新选。未上色候选只在画布点取，不重复默认列树。派生柄回写需要 source、实例变换及可逆能力，不能猜布尔交点母线。

默认无底图新工程：画线→闭合候选→上色并启用区域→毫米厚度→预览/导出；不出现 Source/Fill/Port/Collection/local/world 必答设置。打印分层启用后才显示层数。高级展开/折叠只改会话。

## C08 · 资源、容器、导入与 API

assets 为 `{id,path,mediaType,size,sha256}` 表，仅元数据；`references` 为参考图 `{id,assetId,name,pixelWidth,pixelHeight,pixelToWorld:Affine2D,visible,locked,opacity}` 表，允许零张/多张。资产字节在 codec 参数/会话资源仓库中，以 assetId 关联；不把 data URL 或句柄放进 Document。

`encodeDocument(document,{assets:Record<AssetId,Uint8Array>,appVersion?}) -> Uint8Array`；`decodeDocument(bytes) -> {document,assets}`。保持 .spl 的 mimetype/manifest/project.json 和 containerVersion=1，manifest.documentVersion=4。保留 64MiB 包、128MiB 解压、16MiB 工程 JSON、1MiB manifest、16 个 ZIP 条目的现有限额，资源总数最多 13，路径只允许 `assets/<安全文件名>`。无资源包合法；元数据、哈希、字节和清单一一匹配。顺序稳定、mtime 固定，确定性往返。检查 ZIP 目录边界/重复/路径/声明解压量后再解压，解压后再校验实际尺寸；不得全局放宽旧限额。

旧 codec 默认仍读写 V1–V3；V4 codec 不调用 legacy validator。可抽取纯 ZIP/hash helper，但旧测试必须保持通过，版本分派由 I00 后续接入。未知 documentVersion 不降级读取。

`importLegacy(input) -> {documentV4,idMap,report}` 保留旧源，按版本一次转换；不在 V4 read/evaluate 里 normalize。report 列丢失/含混/不支持映射，失败不返回可正常保存的部分工程。V4 草稿独立命名空间；打开旧文件仅内存导入，首次保存另存，不自动覆盖原件。

Agent API 5.0 与文档版本分开。GUI/API 共用 dispatcher；旧读格式从 V4 投影，旧写索引必须关联当时 revision，缺失或过期拒绝并给迁移说明，不把当前 revision 冒充旧快照。

## 五个贯穿示例与状态反例

| 输入/动作           | 持久变化与结果                                                                                                        | 默认用户所见                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 空部件              | Shape + 空 Program；curves/regions absent，后级 absent                                                                | 一个可命名/移动的部件，无错误和技术目录              |
| 画杯身闭合并上色    | Sketch→Source→Fill；先候选 Region，paint 事务写 appearance 与 enabled=true；Relief→Placed→Body                        | 线条、可点区域、颜色/毫米厚度、成品                  |
| 同部件多线分区/挖孔 | 显式多 Source/Partition/Boolean 子链；selected 输出有稳定引用，属性按 lineage 继承或冲突                              | 当前部件内的区域/孔及局部属性，部件数量不变          |
| 开放 1/8 母线重复   | 共享中心/轴/参数→Mirror→Array→Join→Fill；source 始终开放；改基准与接缝关系重算                                        | 需要重复任务时显示中心/数量/连接边界，返回后普通上色 |
| 纯引用部件          | 无 Sketch，Program 首算子为 curve-reference 或 region-reference，input 指向外部 PortRef；两种引用空间通过任务入口确定 | 可选择/移动的部件，“引用形状”或“按摆放位置切割”      |

每域必须覆盖：CurveSet 正常/空 source/缺失边 blocked；RegionSet 正常环孔/被孔完全移除 empty/未闭合 Fill blocked；ReliefSet 启用贡献/没有启用区域 empty/失效赋值 blocked；PlacedReliefSet 正常毫米高度/上游空 empty/依附环 blocked；BodySet 有效实体/减除全部 empty/无效核结果 blocked。未请求对应输出则 absent。上述反例不得通过创建新 Node、套旧成功结果或自动清空引用解决。

## 冻结记录

- v1 冻结：2026-09-19；基于 1fc9902 和当前代码核对，主代理编制，独立合同审阅者签收。
- 独立走查：五例与 U01–U06、单一权威、各域四状态、服务调用方向通过；修正同 owner Sketch 输入限制、引用首算子、输出契约 port、关系框架和引用别名后复核通过。
- 合同变更：在本节追加影响的 C 编号、消费者、迁移与测试要求。
- v1.1（2026-09-19）：C02 明确 auto 柄公式；C03 运行时 `junctions=[{id,endpoints:[{edgeKey,end}]}]`，每次复制实例的 edge/vertex/junction 派生键全部隔离。注册器增加可选 `copy(operator,{idMap})`，只改已声明的参数引用；scene 负责所有权、输入端口和字段表重挂。求值器唯一应用输入框架，包含停用旁路，算子接收接收者局部结果；新增 `settings:geometry` 依赖键用于容差失效。持久字段不变，不需读取迁移。消费者为 T03/T05/T06/T07/T08；relation、curve 和 evaluation 模块单测已运行，完整 C03 链与集成检查仍须签收。
- v1.1 补充：C03 Join 的端点允许 `instances:[{operatorId,index}]` 固定过滤祖先实例，再用单个 each/next/previous/wrap selector 配对，禁止多命中时取首项。C04 rebase 变换镜像轴角与中心，但阵列步进角不变。C05 attached Shape 取同 Part 的启用 add 输出最高顶面，不接受 cut/through/跨 Part 支持者。真实 C03 联合测试已通过；完整 gate 仍待实际会话/双端验证。普通绘制将开放线条与填面输入分开，闭合路径成员由任务命令显式保存，求值器不猜用途。
