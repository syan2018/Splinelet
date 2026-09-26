# 删点故障与区域身份复审

日期：2026-09-26。审计产品基线：`912fdc8`。本轮交付为复现、评估和重构方案，未宣称产品故障已修复。设计见[区域身份与编辑求值边界提案](../architecture/region-identity-redesign-2026-09-26.md)。

## 结论与上轮验收修正

持久面身份依赖当前边表示，编辑反馈又依赖完整派生求值；两处边界都需要重构。现有精确查询索引不是本次故障的原因，也无法解决它。

上轮[示例验收](data-flow-maintenance-2026-09-26.md)证明指定快照可求值、可导出及已覆盖操作可往返，未证明任意基本样条编辑仍保持区域和赋值。“完整、稳健的可编辑示例”的结论超过了测试覆盖。当前反馈及最小反例推翻该泛化结论；不能再仅以静态输出、区域数或测试总数作为编辑可靠性证据。

## 输入与隔离

用户文件：`F:\Projects\Splinelet\output\sandrone-example.spl`，1,841,548 bytes，SHA-256：

`1dcf19177edb068e1a9ce94e1f4336fc683b28fa39a7dc0923f4d0380877f14f`

本轮先复制为 `outputs/spline-edit-audit-2026-09-26/reported.spl`。基线是 `public/sandrone-example.spl`，SHA-256：

`b05bcc4c2fc9683782b1d01a4a528b5fe61b46d936755ed14b9a05b64acef4ce`

所有实验只读文件或操作内存 clone。浏览器使用桌面前端构建、临时本机端口和全新 Playwright context，将副本作为未绑定文件载入；没有操作用户页面或保存到原文件。

## 真实文件：几何仍可算，身份先阻断

文档差异仅在 `sketch:dd42fa88fb810d6c09de`，路径为 `path:43c8857140e76e8b732d`（头发大型）。删除了 `vertex:f122e40149c39bf9d893`，相邻两条 Edge 被新的 `6b160274-46be-40f0-afd7-1169e58eaf60` 替代；还存在相邻点/柄调整。Program、契约及赋值未变。不能把这个真实样例描述成几何完全等价的纯删点，因此另建了完全等价的最小反例。

当前求值首先在 `operator:078a6a9c0b256271eb55` 返回 `partition-contract-mismatch`，后续 `region-collect` 返回 `blocked-input`，头发的区域发布被整体阻断。隔离 UI 能重现“需检查”；成品检查被拒绝。公开检查中的信息主要退化为“输入端口 input 不可用 / 上游 RegionSet 被阻断”，缺少可直接定位的契约根因。

在删除内存副本中全部 135 处 outputContract 的宽范围诊断实验中（不是只删除首个故障契约）：

| 比较项                              | 结果                                            |
| ----------------------------------- | ----------------------------------------------- |
| 头发发布面数量                      | 修改前后均为 16                                 |
| 完全相同的几何 DTO                  | 13 个                                           |
| 保持完整 OutputRef                  | 4 个，另 12 个身份改变                          |
| 其余 3 面与最接近基线面的对称差面积 | 约 2.671038、0.0000481、0.0782841 mm²           |
| 浮雕与制造放置                      | relief/placed-relief 仍 blocked，原赋值无法解析 |

对称差比较只用于分析几何变化，不用于自动重绑。这个实验说明“全部头发几何无法构造”不符合实际，也说明删除契约并不能修复工程。它不单独证明仅移除某一个契约便能恢复全部几何；首个阻断位置由原始求值阶段诊断确定。

## 最小反例：等价几何的两种失败

10 × 10 mm 正方形由 y=5 的直线分成两个 50 mm² 的面，不使用用户艺术数据。

1. **分段合并误失效。** 实际绘制闭合正方形、分区线，使用 `delete-path-vertices` 删除共线中点，两个面及其并集完全不变。源 Edge token 改变后，旧契约返回 `partition-contract-mismatch`。去契约副本的逐面几何比较证明表示等价；另一个算子探针中，同一直线仅改变共线控制柄保持身份。
2. **路径反转误对应。** 使用真实作者命令建立 Document/Program，给下方面赋红色和 1.25 mm 厚度，上方面赋蓝色和 2.5 mm 厚度，再执行 `reverse-path` 与 `evaluateDocument(regions, relief)`。Edge ID 不变，Path use 的 reversed 切换；求值仍 ready，OutputRef 集合完全相同，几何集合不变。但按同一完整引用逐面比对，质心从 `[5, 2.5]` 变成 `[5, 7.5]`，另一面反向交换；每对面的对称差为 100 mm²。颜色和厚度随引用一起落到对侧物理半区，没有阻断。

这两种结果分别是过度失效与错误对应。只比较总面积、区域数或身份集合会漏掉第二种问题。已提交审计覆盖真实源命令、Document/Program、外观与浮雕求值；没有执行最小反例的 GUI 操作、实体导出或打印，不扩展为全部算子组合验证。

## 源码因果链

- `src/lib/editing/commands/path-node-deletion.mjs`：合并两条曲线时分配新 Edge；返回 changed/removed refs，没有区域连续性映射。
- `src/lib/construction/operators/regions/fill.mjs`：参与轮廓的 Edge token 集合形成 Fill key/lineage。局部表示变化因此重新命名底面。
- `src/lib/construction/operators/regions/index.mjs`：Partition 签名使用完整 `base.ref.key` 和 cutter Edge token；输出再嵌套上游 key，契约按 port/key/lineage/topology 集合比对。
- `src/lib/surface-lineage.mjs`：输出采样线段中点以固定 `2e-5` 容差向源线段归因，再附加相对方向的 `+/-`。反转 cutter 会交换方向标签；这并非与坐标完全无关的拓扑证明。近重合边、切点等情况是需要覆盖的风险，本轮没有把它们当成已复现缺陷。
- `src/lib/construction/provenance.mjs`：继承提案按 owner/instances 和 lineage 子集找候选，未把 operator/port 作为同一 fallback 组边界。它不能扩用为普通编辑的自动重绑。
- `src/lib/construction/operators/regions/partition-identity.mjs`：复制依赖递归解析和重转义多层字符串，反映来源描述与持久名字混合的维护成本。

## 卡顿链与计时口径

实际路径：`use-source-drag.ts` → `runtime-gesture.mjs` → `dispatcher.updatePreview` → transaction clone/validate → `creation-runtime`/`studio-session` 完整显示投影 → `CreationWorkspace` 新 project identity → 70 ms debounce → 四域 Worker 求值。

`creation-workspace.tsx` 的 `calculating` 使用 `evaluatedProject !== p.project`，所以新预览在真正求值前就显示“正在更新区域”。曲线、区域、浮雕、放置一起请求。`planar-stage-cache.mjs` 只有整文档键下的单条缓存，局部源编辑也使完整平面缓存失效。

当前 browser host 通过 evaluate callback 接入 session。旧请求失效会拒绝主线程等待者，未中止已经发给 Worker 的工作。Worker 无取消或最新任务合并协议；这与已有修订校验能防止旧结果接入是两回事。

本机 Node 隔离探针对“头发大型”一个点移动的单次记录：

| 指标                                  | 测量值及口径                                            |
| ------------------------------------- | ------------------------------------------------------- |
| `gesture.update` 同步发布             | 123.69 ms，不含随后显式请求的派生求值                   |
| 独立源事务 clone/edit/validate        | 61.20 ms                                                |
| 独立 source view / creation view 投影 | 20.45 / 9.92 ms                                         |
| 独立 display 投影 clone/freeze        | 9.45 ms                                                 |
| 求值探针                              | 844.90 ms，其中含审计额外执行的 snapshot clone 44.72 ms |
| 完整 creation 调用                    | 1,081.36 ms，含上述探针及投影                           |

各独立探针不是同步发布的嵌套分段，不能相加解释 123.69 ms。这是单次 Node 会话记录，不是浏览器输入到绘制的分位数、稳定基准或跨硬件保证。该移动仍得到 73 cells、0 errors；因此性能问题独立于删点构面失败存在。

数据表示测量（JSON UTF-8 长度；**不是实际 Worker 字节量或内存占用**）：

| 项目                                       | bytes      |
| ------------------------------------------ | ---------- |
| 基线 Document                              | 8,645,390  |
| 文档内 195 处 OutputRef，75 个不同值，累计 | 5,535,236  |
| 最大单个持久引用                           | 231,438    |
| 四域完整 snapshot                          | 52,031,045 |

Worker 的请求/响应实际传递完整 document/snapshot 对象，没有 UI 裁剪。当前 callback 路径在发送前有 editorCapture、request readonly、execute、client request 四次显式完整文档复制；接收后有 client response clone 和 session readonly snapshot clone。四域纯 DTO 冻结后可共享，不能把 store/return 包装再计为重复 clone。浏览器传输自身的 structured clone 另计。

## 可重复入口与证据

```sh
node scripts/validation/audit-region-identity.mjs
node scripts/validation/audit-region-identity.mjs --check
node scripts/validation/audit-spline-edit.mjs --before public/sandrone-example.spl --after output/sandrone-example.spl --probe-unbound
```

`audit-region-identity --check` 检查期望的编辑不变量，当前应以非零退出；这是明确的未修复缺陷门禁。默认模式只输出诊断。`audit-spline-edit` 只读输入、向 stdout 输出摘要；`--probe-unbound` 仅在内存副本去契约，不写文件或赋值。正常审计完成不表示工程通过产品验收。

本机详细证据在 `outputs/spline-edit-audit-2026-09-26/`：`probe-report.json`、`representation-size.json`、`benchmark-report.json`、`browser-report.json`、`reported-ui.png` 及两个最小反例记录。私有输入副本与大体积派生结果不进入版本控制。

本轮执行结果：

- 已提交的 `audit-region-identity.mjs --check` 以 1 退出：反转和共线删点两个期望不变量均失败；两者的实际几何集合均保持。反转在完整 Document/Program/relief 中发生颜色与厚度换面。
- 已提交的 `audit-spline-edit.mjs` 复核出只有 sketches 变化、头发 16 面中 13 个几何 DTO 相同而仅 4 个引用保留；输入文档和文件哈希不变。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`（145 项）、`pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check` 通过。常规单测通过和新增反例失败同时成立，说明覆盖有缺口，不证明本次故障消失。
- `pnpm format:check` 仍列出 313 个既有问题文件；本轮所有改动文本单独检查，未以批量格式化无关代码消除基线问题。

## 本轮交付边界

提交只包含审计入口、事实修正及设计/工作包；未更改产品运行逻辑、文件格式或艺术数据。后续验收必须覆盖“编辑以后仍正确”，并逐个移除身份字符串递归、隐式对应和整工程预览依赖。当前故障不能标记为已修复。
