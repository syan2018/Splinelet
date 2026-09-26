# 区域选择器与源编辑实验记录

日期：2026-09-26。本文件记录本机阶段性证据，不是完整修复验收，数字不是跨设备性能承诺。用户要求从真实需求重新审查后，已撤回 V5 选择器作为最终方案的结论；见[作者模型复审](../architecture/region-identity-redesign-2026-09-26.md)。静态导出及以下单测通过，不能证明实际编辑流程已经正确。

## 用户工程

原始工程 `C:\Users\Syan\Desktop\桑多涅无料\Splinelet-final.spl` 与原内置样例相同，SHA-256 为 `b05bcc4c2fc9683782b1d01a4a528b5fe61b46d936755ed14b9a05b64acef4ce`。用户编辑后的 `F:\Projects\Splinelet\output\sandrone-example.spl` 为 `1dcf19177edb068e1a9ce94e1f4336fc683b28fa39a7dc0923f4d0380877f14f`。两者均不写回。

`repair-sandrone-edit.mjs` 在新副本中迁移已知良好的基准，再明确验证并重放一次相邻边合并和编辑后的源坐标。它要求构造、赋值和其他作者数据一致，不按面积、重叠率或最近面推断绑定；不满足条件时拒绝输出工程。脚本不是日常求值的后备路径。

实验副本 `public/sandrone-example.spl` 与 `outputs/region-repair-2026-09-26/sandrone-repaired.spl` 的 SHA-256 为 `deaec291faf70052623a8acd5cd589bcd9f2d04b887870e033c63546c0240463`。V5 文件 1,587,939 字节，保留用户删点和调点结果。134 个被引用的定义来自 168 个逐算子迁移见证；静态求值有 82 条路径、73 个区域/浮雕、1 个有效实体。它尚未作为完整修复示例交付。

完整验证：24,088 个三角形、12,046 个顶点、零无效边、零退化三角形、单连通组件；尺寸约 80.445 × 97.289 × 5.2 mm。体积 16,747.396746 mm³，与基准的细微变化来自保留的用户源编辑。通用与 Bambu 3MF 均包含 73 个分色网格；保存、冷重开、求值和导出不改写作者数据。

## 复现与修复边界

- 共线删点与反转分区：逐面核对实际几何、颜色、厚度，保存重开与撤销均保持。
- 带孔底面与折返分区：多次交点、拆边/反转/删除新增点保持实际赋值；真实拓扑变化报告定义失效。
- 自动接边：原终点越过底面边界，接边段出现/消失时仍表达同一完整切割用途。用户头发案例的最后两个失效面由该问题导致，已用无私有数据的最小用例覆盖。
- 来源参数：共享反向 use、复合路径、跨基准删点、拆分/反转、桥接/闭合、整条路径重参数化与复制/转移。
- 平面图：交叉、重合、孔洞、零长段、相切、自交、重复顶点边界与断开组件，来源不经距离反查。
- V5 codec 拒绝临时 cell 句柄、旧 outputContract、不一致定义引用和循环定义；失败迁移不替换当前工程、不绑定原文件。

## 性能与浏览器

源线手势不发布完整 editor preview。100 次 Node 手势更新期间区域求值为零；松手一次提交、一次撤销恢复。浏览器真实点、柄、路径输入也验证手势中零 Worker evaluate，提交后一次。

早期隔离证据位于 `outputs/v4-qa/2026-09-26T12-09-37-044Z-41776-57ffd8da/`；点 37–73 ms、柄 35–63 ms、路径 45–85 ms 是 SVG DOM 更新耗时。该旧报告把 MutationObserver 时间误名为 input-to-paint，不能作为屏幕绘制证据；脚本已改为 `inputToSvgMS` 并另测下一 rAF 回调，也只表示绘制帧近似值。

真实大工程的后续 CPU profile 揭示第二条同步链：React 的派生样条预览调用 `readCurvePreviews → evaluatePlanar(['curves'])`，而旧 requestedDomains 只过滤输出，仍执行全部区域算子。证据 `outputs/v4-qa/2026-09-26T12-32-59-788Z-5260-2b7d6f2b/` 记录到松手后 3,738 ms / 3,327 ms LongTask，连续第二次手势 dispatch 约 3,507 ms，且测量期间没有测试主动求值污染。现已删除渲染中的同步求值，按域与真实上游裁剪调度，并让端点吸附读取当前 Worker 结果或当前源端点。

UI 修复后的复测不再出现 tagged-arrangement/JSTS 主线程栈，第二次 gesture dispatch 约 229–443 ms；30 次移动的 DOM p95 70.2 ms、下一 rAF 近似 p95 94.4 ms。该次仍有约 263 ms 的松手后显示/复制长任务，未达到最初 33 ms 预算，不能宣称所有帧均为 60 fps。最终版本测量另见下文。

缓存优化前，即使零算子重算，暖求值仍约 1.9 秒。CPU profile 指向命中前输入 DTO clone/变换和 GC。内建纯求值改为先检查实际依赖，命中后复用冻结 DTO；真实样例冷求值约 4,778 ms、暖求值约 228 ms、单自由顶点约 245 ms（7/263 个组件重算）、用户头发点/柄变化约 658 ms（26/263 个组件）。缓存与独立冷结果深比较一致。41 个头发节点的批量提交由模拟旧逐点完整命令约 630.2 ms 降到约 8.6 ms；该数值仅是命令层，不是浏览器整个松手事件耗时。

## 可重复入口

```sh
pnpm test
node scripts/validation/verify-example.mjs
node scripts/validation/benchmark-source-interaction.mjs
node scripts/validation/profile-v5-region-selectors.mjs
node scripts/tests/browser/studio/test-source-drag-fastpath.cjs
node scripts/tests/browser/studio/test-v5-native-studio.cjs
```

## 第一性复审触发的真实编辑反例

隔离浏览器证据：`outputs/v4-qa/final-v5-sandrone-hair-6/v5-sandrone-walkthrough/v5-sandrone-creation-failure.json`。文件保留完整失败 Document、初始/当前诊断及属性；后续没有删除这个反例或将它改成通过案例。

在用户修改后的 V5 实验副本上，`头发大型` 的第 20 个控制节点从 `[0.444444444, 13.888888889]` 移到 `[1.904298459, 15.105433901]`。独立冷求值复现分区由 12 面变为 11 面；外轮廓与 `path:caeed5ea3fe09a0d0b1a` 的两个交点消失。全项目候选 73 → 72，三个持久选择器 missing，浮雕被阻断。

原视图将 open-path 的 info 和已连接端点的状态也列为 error，显示 88 条错误；诊断投影已单独修复，仅报告明确 error，blocked 无 error 时显示通用阻断信息。但这个显示修复不解决三个选择器失效。

主代理曾把派生分区变化视作必须由用户重新绑定的充分理由。用户要求重新审查后，撤回这一判断：求值图变化不等于作者请求合并区域，不能靠缩小拖动幅度、挑另一个点或检查错误列表为空结束验收。

当时已经执行的门禁：155 项 hermetic 单元测试、typecheck、lint 通过；Rust 格式/check 通过。之后新增的模型消费者测试与诊断测试已定向通过，未重新跑全量。Web/桌面生产构建尚未完成，完整浏览器编辑验收失败；这些状态不能写成“最终门禁通过”。全库格式还有历史基线问题，待最终清点。

在该实验副本中，134 个持久定义有 112 个只是构造整结果（62 boolean、42 closed-path、5 between、3 stroke），另有 20 个 partition cell、1 个 path cell、1 个 fill cell。外观覆盖 70 条、浮雕覆盖 73 条、制造分配 46 条。这说明应先区分整结果与局部作者范围，而不是把所有引用统一送入面选择器。数字仅描述此副本，不是产品容量或架构常量。

## 共享边界作者模型的隔离验证

运行 `node scripts/validation/prototype-author-regions.mjs`。脚本只依赖原有 `region-engine.mjs`，不使用 V5 选择器、历史面映射或旧几何匹配；尚未接入产品。

两个区域具有独立的红/蓝颜色、1.2/2.8 mm 厚度，引用同一边界曲线和共享端点。初始面积各 50 mm²；内部控制柄移动后为 51.213133 / 48.786867 mm²，删除真正内部样条锚点并重建相邻段后为 55.885627 / 44.114373 mm²。精确拆段、表示反转保持当前填充。检查项包含左右测试点归属、零交叠面积、并集面积 100 mm²、纯求值不改作者数据，以及不同属性区域合并被拒绝且文档不变。

限制：每区域只支持一个简单闭环；不是完整填充、孔洞、自交、codec、历史/UI 或旧文件转换实现。因此只作为数据模型试验，不能替代原头发操作的最终验收。
