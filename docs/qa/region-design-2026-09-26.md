# 区域定义设计核查

日期：2026-09-26。基线提交 `38119ea`。本轮任务是选择清理架构，不是宣称产品修复。正式设计维护在[同一架构文档](../architecture/region-identity-redesign-2026-09-26.md)，不另建平行方案。

## 设计收敛

比较了旧 key 修补、空间重绑、通用 CAD 历史命名、持久平面图及声明式区域定义。选择声明式区域定义 + 带来源的派生平面图 + 单向纯求值。

初稿的持久 `identityPending`、异步身份映射写回及历史补齐被撤回。它们没有成为产品代码。新设计坚持同步作者命令是唯一写入入口；Worker 结果只能进入求值/显示缓存。保存作者定义，重开重新解释定义。

只读复审促成了以下约束：

- 区域短 ID 不能代替可独立解释的选择条件，候选唯一也不构成充分证明。
- 表示方向、逻辑方向与实例镜像奇偶性分开；反转不是重新按世界侧别命名。
- 自交/多交点的分支以持久源域表达，禁止临时窗口或交点序号兜底。
- 健康旧文件无法表达是发布阻断项；迁移不完整不能自动覆写原文件或创建混合协议作者态。
- 新协议只承诺明确的选择语义，不能宣称能推断任意拓扑改变后的用户原意。

## 本地源码核查

`resolveSketch` 仍有精确曲线和源实体信息；分区采样将它降成裸 coordinates。`GeometryNoder.toSegmentStrings` 创建 `NodedSegmentString(coords, null)`；后续 union/Polygonizer 没有给当前产品保留可消费的来源图。`contourSignatures` 于是以固定距离和方向点积反向归因。

本地 JSTS 的 `SegmentNodeList.createSplitEdge` 会传递原 segment 的 `getData()`。因此可以从下层 noder 保留来源，而不必先更换全部几何内核。但完整半边图、生成边界来源和选择器解析还不存在，必须单独实现和验证。

这与 [CGAL 对输入曲线与派生图边关系的说明](https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html)相符。另参考了 [Open CASCADE 对操作历史、结果登记和选择重算的区分](https://occt3d.com/dev/doc/overview/html/occt_user_guides__ocaf.html)，没有把外部框架的能力当作本项目已经具备的能力。

## 可运行接口探针

```sh
node scripts/validation/probe-tagged-noding.mjs
```

脚本只使用自行生成的直线和现有依赖，结果写 stdout，不读写用户工程。使用 `MCIndexSnapRounder(new PrecisionModel(1e9))`、`NodedSegmentString(data)` 及 `NodingValidator`。

| 输入                 | 观察                                                  |
| -------------------- | ----------------------------------------------------- |
| 两条相交直线         | 各拆成两段，共 4 段；每段保留原 metadata 对象         |
| 长线与反向共线重叠段 | 重叠区域同时保留两份不同来源；尚未进行 dissolve       |
| 反向直线被交叉切分   | 保留反向标记，源参数区间分别为 `[1, 0.5]`、`[0.5, 0]` |

探针中的直线交点恰好位于精度网格上，参数由已知直线解析恢复。这不证明一般 Bézier 的参数恢复、snap 偏移、完整平面图/面走访、重合边归属、孔洞、RegionSet 集成或旧文件迁移。尤其不能把“noder 可带 data”描述成“区域身份已修好”。

本机初始证据位于 `outputs/region-design-2026-09-26/`；可重复脚本已进入版本控制。产品反例仍使用 `audit-region-identity.mjs --check`，其失败与底层探针通过并不矛盾。

## 验证边界

本轮仅修改设计/实施文档和验证脚本，没有修改产品运行代码、schema、几何或内置示例。原有布局和行为尚未切换。实施门禁仍要求真实命令、冷求值、保存重开、逐区域属性对应以及示例迁移，不以文档完成代替产品完成。

本轮执行：来源探针通过；当前产品 `audit-region-identity.mjs --check` 仍以 1 退出。`pnpm typecheck`、最终 `pnpm lint`、`pnpm test`（145 项）、`pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check` 通过。探针初次 lint 的 helper 名称误触 React Hook 规则及 const 问题已修正，没有放宽规则。

全库 `pnpm format:check` 仍报告 313 个既有文件；本轮修改文本单独格式检查。文档中的本地链接共检查 58 个，无断链。完整日志在 `outputs/region-design-2026-09-26/`，最终 lint 结果为 `lint-final.log`。没有将这些静态/现有门禁通过解释为新区域模型已经完成。
