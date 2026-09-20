# V4 重构复审与默认预览修复

日期：2026-09-20。审阅基线：`dd7b299`，本次修改前工作区干净。审阅范围是 V4 文档、场景与构造求值、原创作视图适配、对象编辑意图、Agent 入口及浏览器验收接线；这不是原生桌面完整交互或所有几何算子的重新签收。

## 判断

核心模型已经符合此前重构的主要方向：`Node.pose` 与局部 Sketch 分离；Vertex、Edge、Path 有稳定身份；Datum/Parameter/Relation 是持久定义；Program 显式发布 curves/regions；外观、浮雕和制造属性通过 OutputRef 关联；事务、预览、历史与持久化共享 V4 文档。`projectStudioDisplay` 是只读投影，没有把 GUI 的旧外形重新变成另一套可写工程。

但“内核支持”还不能等同于“用户能完整编辑”。初次复审的主要缺口在最终结果的显示、跨部件失败隔离、默认/覆盖值的编辑语义，以及场景树和 Agent 的产品接线。以下四项保留为初次发现；后续修复结果和新的验证记录见文末。

## 初次发现（按优先级，修复前状态）

### R1 · P1：单个部件构面失败会清空无关部件的浮雕预览

位置：[resolveRelief](../../src/lib/relief/resolve.mjs)、[evaluateDocument](../../src/lib/evaluation/evaluate-document.mjs)、[projectCreationView](../../src/lib/editor/creation-view.mjs)。

`evaluateDocument` 把全部 Shape 的 RegionSet 传入一个 `resolveRelief`。任意输入 blocked，或任意输出赋值失效，该函数会返回不带成员的全局 blocked。Creation 投影据此把其余正常面的 `painted/enabled` 都设为 false；三维视图只绘制 painted 面，于是无关部件也消失。

已实际复现：从 `repeatedRingDocument()` 建立重复环，再用 `draw-path` 建立一个独立闭合矩形，启用两者浮雕。正常时两者 painted=true；清空环的 `join.params.connections` 后，矩形的 regions 仍然 ready，却变成 painted=false，relief 全局 blocked。它不是矩形的属性被用户关闭，也不是过期结果。

修复边界：以 Shape/OutputRef 保存带身份的阶段状态与诊断；独立成员继续生成当前 revision 的预览，只有真实依赖失败结果的成员暂停。浮雕的“用户启用状态”不能由整个 ReliefSet 是否 ready 推导。实体合并、层堆叠及选定 Part 导出仍须检查其完整依赖，不能简单忽略错误或导出残缺模型；也不能用上一帧实体假装当前有效。

验收：两个独立部件中一个 Fill 失败、失效赋值、附着目标失败、隐藏/排除分支、修复与撤销；正常分支的当前预览保留，依赖分支有可定位诊断，相关导出正确拒绝。

### R2 · P1：完整“镜像 → 阵列 → 接合 → 构面”创建入口尚未接通

位置：[compileModifierAdd](../../src/lib/editor/modifier-intents.mjs)、[ProgramModifierAdd](../../src/components/creation/program-modifier-add.tsx)、[原 Studio API](../../src/components/studio/studio-app.tsx)、[API 5.0 模块](../../src/lib/agent/v4-api.mjs)。

底层 Program 支持 Join/Fill，已导入的构造可以求值。然而 GUI 的添加菜单和 `modifier_add` 适配器只允许 `curve_mirror` / `curve_array`，请求 `type: 'fill'` 会直接报“尚不支持类型”。当前 Studio 只挂载 API 4.1；生产 `src` 内没有 `createV4AgentAPI` 的调用方。因此 Agent 也不能通过默认页面使用已实现的 `authoring.run`、稳定引用与能力发现补齐这条流程。

仓库 [draw-cup-emblem](../../scripts/examples/draw-cup-emblem.mjs) 仍调用旧 `modifier_add(fill)`；镜像/阵列请求还省略了新适配器要求的 `targets`。即使迁移后的旧图样能打开，也不证明用户能从开放的 1/8 源线重新创建它。任务文档曾明确记载 API 接线未完，这里是尚未完成的产品能力，不是 API 内核单测漏过的算子错误。

已在本次 Web 生产构建运行 `pnpm test:browser --suite legacy --case agent-spline-authoring --target web --port 4181 --inspector-port 9232`：退出码 1，实际首先在 `drawCupEmblem` 添加修改器时被“曲线链包含跨域或多输入步骤”拒绝，尚未执行到 Fill。完整证据位于 `outputs/v4-qa/review-agent-authoring-2026-09-20/manifest.json`；对 `compileModifierAdd(type: 'fill')` 的独立调用也确认被拒绝。需要修复整个创建旅程，不能只给旧脚本补一个 targets 字段。

修复边界：在当前 Studio host 中接入同一个 editor/evaluation session 的 API 5.0，保留受控的 4.1 兼容适配；为 Join 与 Fill 增加明确的构造动作和界面入口。Join 记录端点实例对应，Fill 只消费已接合的曲线；不要恢复“按距离猜拓扑”的旧构面语义。源 API 写操作也必须携带读取时的 revision，不能由适配器自动拿当前 revision 代替。同步迁移样例、HTTP/WebMCP 桥和能力说明。

验收：仅通过默认页面公开 API，从空 Shape 创建开放 1/8 源线、镜像、四向阵列、显式 Join、Fill、赋色、厚度、保存重开和导出；测试过期 revision 拒绝、一次撤销，以及 GUI/API 的同一结果身份。

### R3 · P2：整体 Z 位移会对继承默认放置的局部覆盖重复应用

位置：[setObjectPlacement](../../src/lib/editor/creation-basic-intents.mjs)。

`records` 的首项是默认值；循环先更新其 placement，后续只有 thickness 等字段的 override 再用已更新的 `fallback.placement` 计算原位置，delta 被加了两次。这会悄悄改变同一部件中区域的相对高度。

已实际复现：部件默认 zMM=1，某面的 override 只设 thickness=3、未覆盖 placement。在原 `object` 意图中把 Z 改成 2 后，默认 placement 变成 2，该面却新增 placement.zMM=3；预期都应为 2。

修复边界：计算命令前先解析并固定原始有效放置；分别更新默认放置和显式覆盖，不把本来继承放置的覆盖物化为独立 placement。对 attached offset 使用相同规则，并保留局部已有差值。

验收：只有厚度/启用状态的覆盖、显式 free/attached 放置、同部件多种局部 Z、正负位移、取消附着、一次撤销与保存重开。对最终 placed-relief 的底面断言，而不只看文档字段。

### R4 · P2：场景 Group 在主作品树中不可见，父级状态无法编辑

位置：[projectCreationView](../../src/lib/editor/creation-view.mjs)、[CreationWorkspace 作品树](../../src/components/creation/creation-workspace.tsx)、[路径集合投影](../../src/lib/editor/path-groups.mjs)。

模型与 Creation 投影已经有递归 `tree`，包含 Group、Shape、parentId 和继承的隐藏/锁定状态；主作品树仍只遍历扁平的 `doc.objects`，这个数组仅含 Shape。导入或通过规范命令创建 Group 后，父级在 UI 中没有可选行，子级却受它的可见性与锁定影响；也不能在主树上操作整个组或理解跨父级拖放被拒绝的原因。

旧路径“编组”如今投影为 Collection，这个方向正确，但 Collection 不能代替可变换的 Group。现有“合为一个部件”会做源所有权转移，也不能冒充 Group。

修复边界：沿用现有作品树的布局与行样式，消费已经发布的递归 tree，补齐 Group 行、父级有效状态提示、整组选择/移动、保持世界位置的换父级。Shape 内继续展开源线和区域；路径 Collection 继续作为独立整理索引。

验收：至少两级 Group，移动父级且所有源坐标不变，父级隐藏/锁定及恢复，跨组拖放 keepWorld、解组、撤销、保存重开，以及 GUI/API 同一选择身份。

## 本次默认预览修复

原逻辑明确以 `displayMode='reference'` 启动，将所有最终区域的 fill-opacity 设为 0；进入节点/描线工具又强制回到底图。因此面已经正确求出，用户默认仍只看到线条。这是显示策略问题，不能靠烘焙修改器或补画源面解决。

本次改动：默认使用叠色；工具切换保留用户显式选择的底图/叠色/分色模式。继续使用同一 revision 求值后的最终区域，保留孔洞、候选区域和浮雕启用语义；显示操作不写文档、历史或导出参数。用户主动选底图时仍会隐藏填色。

回归 fixture 复用 [repeatedRingDocument](../../scripts/tests/fixtures/v4-programs.mjs)：两个开放 1/8 源边，经镜像、四向阵列和显式 Join 产生 16 条派生边，Fill 得到一个带孔面。它只验证结构，不修改用户的金色图案。

运行 [默认预览浏览器回归](../../scripts/tests/browser/smoke/test-v4-final-preview.cjs)：

```sh
node scripts/tests/browser/smoke/test-v4-final-preview.cjs
```

修复前断言失败：默认 fill-opacity=0；修复后默认可见、切节点工具保持可见、显式显示选择保留、文档不变和重新加载通过。平面与立体截图已人工检查；测试使用独立临时端口、新 context、原 Studio 与真实 Worker。产物：`outputs/v4-qa/final-preview/`。

## 初次建议的修复顺序

1. R1 故障隔离，避免编辑一个部件让整个作品消失；先确定阶段 DTO 的失败范围，再修改所有消费者。
2. R3 默认/覆盖值的位移语义，修复数值错误并补针对性回归。
3. R2 打通原始图样的完整创建旅程，将该旅程纳入日常浏览器门禁，而不只验导入成品。
4. R4 接上场景树，用真实父子对象验证整个编辑流程。

现有架构方向可继续使用。这些问题主要需要完成和校正跨模块契约，无需再更换文档模型或另建一套前端。

## 初次复审的验证记录

- `pnpm check:all`：退出码 0，包含类型、lint、129 项 hermetic 单测、格式、Rust 格式/编译检查和 Web/Tauri 前端生产构建。日志：`outputs/v4-qa/final-preview/check-all.log`。
- `node scripts/tests/browser/smoke/test-v4-final-preview.cjs`：退出码 0，默认构面显示与工具切换回归通过，平面/立体截图已检查。
- `pnpm test:browser --suite legacy --case object-move --target web`：退出码 0，生产构建中的对象移动专项通过。证据：`outputs/v4-qa/review-object-move-2026-09-20/`。
- Agent 图样创建浏览器旅程：退出码 1，具体失败见 R2，不能算作通过或跳过。
- `node scripts/tests/browser/smoke/test-v4-original-studio.cjs`：退出码 0。覆盖 Sandrone、原布局、节点/对象编辑、撤销、OPFS 保存重开、V4/旧工程/示例打开、无效文件保留及导出。原脚本在节点编辑/撤销后，未等待当前求值便启动对象拖动；补入 `creation_inspect` 等待和对象选区断言后，独立复现及完整旅程都通过。只调整测试同步点，不放宽产品的旧结果保护。日志：`outputs/v4-qa/final-preview/original-studio.log`，结果：`output/playwright/v4-original-studio/result.json`。
- R1/R3 的实际求值反例、R2 的 Fill 入口拒绝、R4 的 Group 与扁平列表差异已分别复现，数值记录在 `outputs/v4-qa/final-preview/review-findings.json`。这是未修复问题的证据，不计作产品验收通过。
- 修改文档的仓库内文件链接、最终 lint/格式及 `git diff --check` 已检查；未执行原生桌面窗口的交互验收。

上述未修复项不因静态检查或已有单测通过而视作完成。

## 2026-09-20 修复结果

R1–R4 已在同一 V4 文档、事务、求值器和原 Studio 中实现。默认叠色显示最终构面，切换工具保留用户选定的显示模式。没有修改用户正在编辑的工程或源图样。

- **R1：独立分支预览。** relief/placed-relief 按 owner 保留当前求值的分支；某部件失败时，独立部件仍可预览。附着与打印层按实际依赖递归解析，目标不完整时阻断依赖者。作者的 enabled/painted 不再由全局求值成功与否改写；未放置区域标记 flatOnly，不拿旧实体替代。聚合 blocked 不含 value，实体和导出无法误用局部成功结果。
- **R3：继承放置。** 整体 Z 编辑只移动默认放置和已有的显式 placement 覆盖；只有厚度等字段的覆盖继续继承，不会重复偏移。已检查实际 placed-relief 底面、附着/解除附着、负偏移、撤销与文件往返。
- **R2：完整创建流程。** 原 host 接入 API 5.0 的规范命令、稳定引用、求值和导出。GUI 可添加和编辑 Join 的实例端点对应以及 Fill；Fill 作为标准修改器显示，已有失败 Fill 前仍可补入曲线修复步骤。样例迁移为开放源线 → 镜像 → 四向阵列 → 显式邻接 → Fill。旧写入口要求调用方提供 expectedRevision；WebMCP/HTTP 的二进制导出使用明确 base64 信封。
- **R4：场景树。** 主作品树展示真实 Group/Shape 层级，支持建组、解组、隐藏、锁定、整组移动、父级选择与拖放换父级。Group 保留 node 身份，Collection 继续只负责整理路径。整组移动不改源坐标，换父级保留世界位置；Group 属性面板不再显示部件上色控件。

新回归与证据：

- `pnpm check:all`：退出码 0；130 项 hermetic 单测、类型、lint、格式、Rust 格式/编译、Web 与桌面前端构建通过。日志：`outputs/v4-qa/review-repair-check-all.log`。
- `test-v4-final-preview.cjs`：默认最终面、显示切换、原界面创建镜像/阵列/Join/Fill、两级 Group、隐藏/锁定、整组拖动、带位移父级间的 keepWorld 拖放与撤销通过。截图已检查；日志：`outputs/v4-qa/review-repair-preview.log`。
- `test-v4-original-studio.cjs`：完整原 Studio 的编辑、撤销、保存、V4/旧工程/示例打开及无效文件保留通过。并发旧写入现在断言过期请求被拒绝，重新读取后可正常写入。日志：`outputs/v4-qa/review-repair-original-studio.log`。
- `test-v4-review-repairs.mjs`：覆盖分支失败、附着与层依赖、隐藏/排除、继承 Z、场景层级、文件往返及 JSON 二进制字节保真。
- Web 生产构建 `agent-spline-authoring`：退出码 0。公开 API 从开放源线创建杯上纹样，最终为一个五孔面；原杯子和既有源线不变。验证修订拒绝、故障隔离、严格导出、一次撤销、派生曲线、GUI/API OutputRef 一致、修改器界面编辑、保存重开及真实 3MF 文件。证据：`outputs/v4-qa/repaired-agent-authoring-pass3-2026-09-20/manifest.json`；正视/立体截图已检查。
- Web 生产构建 `object-move`：退出码 0，证据：`outputs/v4-qa/repaired-object-move-2026-09-20/manifest.json`。
- 最终 lint、格式和 `git diff --check` 通过；已检查 95 个修改文档中的本地文件链接。其余兼容 GUI 用例已迁移修订参数，本次未重新运行整个 legacy 浏览器套件。

当前限制：BodySet 和选定 Part 导出仍保守要求所有未排除制造分支完整；本次未实现“跨 Part 故障隔离后单独导出正常 Part”。原生桌面窗口未做交互验收，桌面前端构建与 Rust 检查已通过。旧 GUI 测试已迁移读取修订的兼容调用助手，协议测试直接使用公开入口，不自动补齐缺失修订。
