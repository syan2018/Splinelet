# 区域更新性能评估（2026-09-26）

本文保留优化前的评估状态与当时测量；后续实现、独立基线与回归结果见[身份优化验收](identity-optimization-2026-09-26.md)。

## 结论与测量边界

存在明显优化空间。本次使用内置 Sandrone 样例复现秒级求值，发现主要热点是区域身份的重复序列化和匹配。无需改变几何精度或替换几何引擎，仅在内存中试验提前排除不相同的区域引用，就使「求值＋创作视图投影」的三次测量中位数由 **3606 ms 降至 1269 ms，减少约 65%**。完整快照及视图的 JSON SHA-256 一致。

这是 Node 进程内实验，**不是浏览器端到端延迟，也不是已上线的优化**。未包含 Worker 消息传输、编辑会话包装、React 提交和浏览器绘制；未打开用户正在使用的页面或写入用户工程。产品源码没有因本次评估而修改。

- 环境：Windows，Node v24.14.0；基准使用当前工作区，其中有正在进行的未提交 UI 改动。
- 基线提交：`ee96fa915ef56a4c37cc50966c38ff521a3f47a11`。这不是干净提交树的性能认证。
- 输入：[public/sandrone-example.spl](../../public/sandrone-example.spl)，只读解码为 V4。
- 样例 SHA-256：`0997dd9a6d41ae21def3e1555c0be4286668a29f4273fa4e9758c188cc883a86`。
- 规模：11 个节点、11 个 Sketch、76 条源路径、249 个算子、69 个输出区域；测量中的区域错误数为 0。
- 机器状态有波动：早期独立批次约 2.7–3.0 秒，保存复现脚本后的基线批次约 3.6–3.7 秒。因此不把绝对毫秒值当作产品承诺，也不叠加不同批次的提速百分比。

## 提示实际等待的流程

入口见 [creation-workspace.tsx](../../src/components/creation/creation-workspace.tsx) 的 `calculating` 和求值 effect：

1. 展示工程改变后，`evaluatedProject !== p.project` 立即表示结果过期。
2. 延迟 70 ms 后请求 `runtime.evaluate('creation')`。
3. [creation-runtime.mjs](../../src/lib/editor/creation-runtime.mjs) 请求 `curves / regions / relief / placed-relief`。
4. 经 document session 和 [browser-studio-host.ts](../../src/lib/editor/browser-studio-host.ts) 将工作交给 [document-worker.ts](../../src/lib/evaluation/document-worker.ts)。Web 和桌面前端共用此装配。
5. Worker 求值后，主线程还要执行曲线预览投影及 `projectCreationView`，最后才发布 scene、结束更新状态。

因此，提示里的“区域”覆盖了平面构造、浮雕属性、打印放置、导出视图准备、消息往返和界面数据整理。这个请求不包括实体生成 `bodies`，不是 Manifold 实体布尔计算引起的等待。核心计算已使用 Worker，但界面数据投影仍在主线程执行。

## 主要证据

### 1. 区域身份匹配是首要热点

[appearance.mjs](../../src/lib/relief/appearance.mjs) 的 `sameOutputRef` 每次都为左右引用完整计算 `outputIdentity`，其中包括 `key / instances / lineage`。外观覆盖、浮雕覆盖、制造归属、视图投影等多处对列表逐项匹配，反复处理相同对象。

本样例中，最大的单个身份字符串长 **231,360 个字符**。完整求值和视图投影调用这个模块的 `outputIdentity` **39,798 次**。单独 CPU 采样批次里，此模块 `stable` 函数的自身采样时间约占 **62%**；另一套 provenance 序列化约占 5%，依赖指纹序列化约占 6%。这些是采样占比，不能解释成各优化可直接相加的收益。

保存的实验每种模式测量三次，测量前预热；输入在每次运行前重新复制，输出校验不计入耗时。各列独立取中位数，所以列间可能存在小量求和差异。

| 实验模式                                             |    求值 | 创作视图投影 | 两项合计 |               身份函数调用 |
| ---------------------------------------------------- | ------: | -----------: | -------: | -------------------------: |
| 原实现                                               | 2315 ms |      1291 ms |  3606 ms |                     39,798 |
| 单次求值范围内按引用缓存身份                         | 1321 ms |        25 ms |  1350 ms | 39,798，其中 39,338 次命中 |
| 先比较 owner/operator/port/key，明显不同即返回 false | 1196 ms |        72 ms |  1269 ms |                      1,682 |

第三种实验不使用身份缓存。它仅对肯定不相同的引用提前退出；可能相同的引用仍执行原有完整比较，保留 instances 和 lineage 的语义。两种实验是分别与基线比较，不是累计改动。

全部 9 次结果都有相同的完整快照＋视图摘要：`47d14b99822e6c992340d0ab43408bf0fb48a60bad20bf5c119d0715ce50ea7a`。这验证了此样例，尚不等于已验证所有命令、坏引用、拓扑变化和保存兼容性。

建议先落地短路比较，再考虑按一次不可变快照建立身份和赋值索引。不要直接给可变引用套跨修订的全局 WeakMap；引用内容变化时可能得到过期身份。不能为了速度省略 lineage 或 instances 的最终判定。

### 身份子系统的进一步检查

继续检查身份的生成、传播、持久化和复制流程后，确认短路比较只解决了一部分问题：

- 样例文档中出现 190 个 OutputRef，按现有完整身份规则去重为 71 个。这里统计的是文档内所有已存引用，不等于最终输出区域数量。
- 最大身份字符串的 231,360 个字符中，150,818 个是反斜杠，约占 65%。它的 key 顶层为 partition，长度 86,929；其中上游 boolean key 长 6,596，再上游 path key 长 79。partition 的轮廓签名也引用 base key，重复的来源再经过多层 JSON 字符串编码，产生显著的转义膨胀。
- `construction/provenance.mjs` 与 `relief/appearance.mjs` 各自定义了 `outputIdentity` 和稳定序列化。两者的主要身份字段相同，但缺失引用的处理不同，不能未经审阅直接合并。
- 属性匹配、引用解析及继承提案普遍使用 region × assignment 的嵌套扫描。继承阶段还以 `lineage.every(...includes(...))` 做集合包含判断。
- `creationCellKey` 将完整身份再次放进界面 key。复制命令及 partition identity 模块还需要递归解析字符串中的 JSON，才能替换实体 ID。这说明编码方式已影响查询、传输和命令维护。

建议把后续工作划分成三个边界，仍属于待实施建议：

1. **统一身份服务与运行时索引，不改文件格式。** 每份不可变快照建立 `完整身份 → 区域列表/赋值列表`，消费者复用索引；重复引用保留为列表以检测歧义，不能被 Map 静默覆盖。身份规范化只做一次。运行时句柄仅在所属 session/快照内有效，旧工程继续保留原 key、lineage 和 instances。
2. **分开精确绑定与继承候选查询。** 精确绑定查身份索引；分裂/合并继承按 owner 和 instances 分组，用 lineage token 倒排索引缩小候选，再验证完整集合包含。Set 或有序 token 集合替代反复 includes。候选冲突仍显式返回，提案不能直接改写用户赋值。集合算法不会消除输出本身很大的最坏情况。
3. **重构来源表示，避免递归字符串展开。** 将来源保存为可共享的结构化节点/有向无环图，子结果引用父节点，并与运行时查找句柄分开。稳定身份、来源解释、几何内容版本需要各自明确语义。拓扑契约决定什么时候保留、分裂或重建身份；不能每次求值随机生成 ID，也不能直接把坐标或数组位置作为区域身份。持久化结构变化需要版本化迁移与旧赋值映射验证。

精确匹配的扫描成本可从大致 `O(R × A × L)` 转为先付一次规范化成本，再做索引查找；R 为区域数，A 为赋值数，L 为身份表示长度。这里是复杂度分析，不是新增的端到端性能测量。若采用摘要加速索引，应保留碰撞校验；只把长字符串临时 hash 一遍仍无法解决来源构造、复制与传输的膨胀。

### 2. “只求曲线”没有裁剪计算图

[evaluate.mjs](../../src/lib/construction/evaluate.mjs) 先对拓扑序中的全部组件调用 `evaluateComponent`，最后在发布结果时才使用 `requestedDomains` 过滤。这意味着 `requestedDomains: ['curves']` 没有避免区域构造。

实测只请求 curves、只请求 regions、请求两者，均执行全部 **249 个算子**，包括 67 个 path、71 个 boolean、10 个 region-collect、5 个 between、2 个 partition。单次 curves 请求仍约 **649 ms**；这是独立探针的一次测量，不作稳定分位数。

[creation-runtime.mjs](../../src/lib/editor/creation-runtime.mjs) 的 `readCurvePreviews` 同步调用这个求值器。[creation-curve-preview.tsx](../../src/components/creation/creation-curve-preview.tsx) 在 `useMemo` 中调用它；创作工作区在 edit/trace 工具启用 live 预览。因此，源线编辑存在在主线程同步执行全图平面构造的路径。

建议从实际需要的输出端口及预览阶段出发，仅计算其依赖闭包。必须保留高级面板需要展示的中间曲线，以及 curve-reference 等算子的真实上游；不能简单按算子输出类型删掉所有区域算子。性能验收应确认：只预览独立曲线时不会执行不相关的区域算子。

### 3. 平面缓存失效范围过大，算子缓存未跨 Worker 请求保留

[planar-stage-cache.mjs](../../src/lib/evaluation/planar-stage-cache.mjs) 的 key 基本包含整个 document，仅去掉部分 pose，并记录世界引用的坐标系。改名、颜色、厚度、打印层高仍会改变 key。

独立探针中：同文档命中约 43 ms；改名、颜色、厚度、层高都导致平面阶段重新求值，单次约 669–743 ms。这些是该批次单次数据。部件 pose 的复用另受 world-result 引用、datums/relations 限制，不能宣称移动部件一定命中。

下层 `evaluateConstruction` 已有 `options.cache` 和组件依赖指纹，但现有 Worker→document→planar 路径未提供持续存在的组件 cache，默认每次新建 Map。外部探针传入持续 cache 后，同文档第二次算子执行数为 0，但仍花约 **468 ms**，第一轮约 668 ms。这说明只接上缓存不够，输入映射、指纹、复制和依赖扫描也占时间。

建议按几何、外观、浮雕、制造域拆分失效：改颜色/厚度不重做平面区域；改一个 Sketch 只重算它的构造依赖。先明确依赖契约，再接组件缓存，并限定 epoch、registry、删除节点和历史切换时的生命周期。

### 4. 快照体积和过期请求是下一层问题

- 本样例 V4 文档 JSON 约 **8.5 百万字符**，求值 snapshot JSON 约 **50.4 百万字符**，创作 view JSON 约 **15.3 百万字符**。这是 JSON 表示长度，**不是测得的 Worker 实际传输字节数**；structured clone 可以保留共享引用。
- 原始样例的完整 snapshot 一次 `structuredClone` 约 39–44 ms。Worker 消息及 session 中还有复制/冻结边界，实际端到端开销需要浏览器 trace 继续确认。
- [session.mjs](../../src/lib/evaluation/session.mjs) 能拒绝过期结果，但取消 pending 并不等于中断计算。[document-worker.ts](../../src/lib/evaluation/document-worker.ts) 没有取消协议；同步平面求值期间，后续消息无法立刻打断它。70 ms 延迟只能合并尚未发出的请求。

建议在发送端限制为“一个执行中请求＋一个最新待处理请求”，替换尚未开始的旧请求，并保留 epoch/revision/previewVersion 的结果保护。若要中断正在执行的计算，需要任务分段或明确的 Worker 重建策略。先测连续操作的排队延迟，暂不量化这一项收益。

快照精简应先减少重复携带的中间结果和重复主线程投影。长期可评估紧凑的运行时身份索引，但修改持久化 key/lineage 涉及区域绑定、继承、拓扑契约和文件兼容，不宜作为第一步。

## 建议实施顺序与验收

| 顺序 | 改动边界                                  | 验收重点                                                                         |
| ---- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| 1    | 身份短路比较；一次快照内复用身份/赋值索引 | 完整身份语义、重复赋值冲突、过期引用、拓扑分裂/合并、样例完整输出等价            |
| 2    | 曲线预览按所需阶段裁剪依赖图              | 源线拖动不运行无关区域算子，中间阶段和世界引用仍正确                             |
| 3    | 按域和依赖进行增量求值                    | 颜色/高度不触发平面算子；局部编辑仅影响下游；undo/redo、预览取消、换文件保持正确 |
| 4    | 待处理请求合并、结果体积和投影复用        | 连续输入到最新画面的延迟、主线程长任务、快照大小和峰值内存                       |

首轮不需要降低采样精度，也不需要重写几何内核。应保留旧画面并标注结果正在更新；能否允许某项操作要按其是否依赖当前区域身份分别判断，不应直接移除当前防止使用过期区域的保护。

实际实施前后，建议在隔离浏览器 context 和独立端口分别测：改颜色、改厚度、移动无世界引用部件、移动有引用部件、源节点拖动、分区/布尔编辑、连续快速操作。记录输入提交→Worker 开始→各阶段结束→主线程投影结束→下一帧的 p50/p95；本次 Node 结果不冒充这些指标。

## 本地证据与复现

以下为本次工作区内的本地产物，位于被 Git 忽略的 outputs 目录，不是可从干净仓库恢复的公开测试入口：

- [identity-probe.mjs](../../outputs/evaluation-performance-2026-09-26/identity-probe.mjs)：使用 Node 的模块加载 hook，仅在内存替换比较函数，分别运行基线、临时身份缓存和提前排除实验。
- [identity-experiment.json](../../outputs/evaluation-performance-2026-09-26/identity-experiment.json)：9 次原始记录、输入摘要、输出摘要、运行时版本。
- [evaluation.cpuprofile](../../outputs/evaluation-performance-2026-09-26/evaluation.cpuprofile)：独立的阶段测量 CPU 采样，可用 DevTools 加载。采样还包括少量诊断 JSON 输出，不视作浏览器 trace。

在当前工作区使用 Node 24 可复跑：

```sh
node outputs/evaluation-performance-2026-09-26/identity-probe.mjs
```

运行前应停止其他重负载任务。实验会覆盖自己目录下的 JSON 结果；不会改写产品源码或输入工程。若源文件函数发生变化，脚本会在替换不匹配时失败。

仓库基线检查日志同样保存在该 outputs 目录；这些检查验证当前工作区，不代表临时实验已经成为通过全套回归的产品补丁。

本次执行结果：`pnpm typecheck`、`pnpm lint`、`pnpm test`（144 个单元测试）、`pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check` 均通过。`pnpm format:check` 未通过，报告 349 个文件存在格式问题；本次没有批量格式化这些文件。本报告单独格式化并检查本地链接，`git diff --check` 通过。
