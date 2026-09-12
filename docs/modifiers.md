# 面修改器

日常流程仍为描线 → 颜色与高低 → 立体预览。选中部件后，右侧独立的「修改器」页提供可选的组合操作。卡片默认只展示名称、启用开关、作用范围和操作摘要；参数与基础面来源折叠。支持双击改名、拖动排序、菜单上下移动/删除，所有更改参与同一撤销与自动保存流程。

## 数据和计算

- `object.modifiers` 从上到下作用于该对象的面：布尔差/并/交、开放线分区、轮廓偏移。
- `object.sources[featureId]` 是旧工程中各基础面的来源程序：一个基础区域引用和可编辑的布尔步骤。先计算来源程序，再分区，再执行对象修改器，最后按面的颜色/厚度拉伸。
- 对象操作数引用对方的最终面结果，可多层嵌套。引用循环、丢失来源、无效边界或失效目标会报告错误，失败对象没有可导出几何，不回退到旧快照。
- 源贝塞尔节点、旧模型定义保持不变。迁移后，已提取步骤由 `sources` 管理；原模型配方保留供基础引用及兼容使用，不再是该面完整构造的第二份编辑入口。
- `roles: hole` 是创建受管差集修改器的快捷操作。迁移合并相同路径的重复减法；停用可恢复完整面，删除会将路径用途改为参考，避免隐藏减法重现。
- 面范围使用 feature/region ID、闭合边界 ID 或生成修改器输出 ID。旧分区引用附拓扑签名。丢失或歧义引用要求重新选范围，不能悄悄改到另一个面。
- 分区输出用相对有向分区线的左/右标识，颜色和厚度保存在生成修改器的 `styles` 中。下游步骤可只选其中一区。分区线必须一次贯穿单个连通面；复杂多次贯穿拆为多步。
- 引用和参数是持久数据；计算出的面、三角网格、诊断信息仅存在运行时。预览、SVG、Blender 和实体导出使用同一个实时计算结果。
- 新建底板通过引用对象外轮廓并偏移构造。其轮廓随来源更新；垂直叠放关系与二维几何引用分别求值。

本版是 **拉伸前的面修改器**，并非 Blender 任意三维网格修改器。合并不同颜色/高度的多个面会要求先统一属性或缩小范围，避免隐式丢掉材质/高度。带修改器对象保留独立来源归属，用对象引用组合；不支持直接合并来源所有权。

## Agent API

`window.traceStudio.call('creation_inspect')` 返回 `creation.objects[].modifiers`、`sources`、`cells` 和 `modifierStatus`。后者提供每步输入的 `inputOptions[].ref`、面积前后值、影响数和错误。先读取当前结果，再提交一个可撤销命令：

```js
await traceStudio.call('creation_command', {
  action: 'modifier_add',
  args: {
    objectId,
    type: 'boolean', // 或 split / offset
    operation: 'difference', // union / intersection
    input: { kind: 'object', id: toolObjectId }, // 或 path / region
    targets: { kind: 'selected', refs: [inputOptions[0].ref] },
    name: '局部凹槽'
  }
});
```

- `modifier_add`: type/name/input/operation；offset 用 `distanceMM`，split 可用 `joinMM`。默认 targets 为 all；可传当前 `cellKeys` 自动转换为稳定引用。
- `modifier_update`: objectId/modifierId 和 `changes`（name/enabled/operation/input/targets/distanceMM/joinMM）；也可顶层传 targets/cellKeys。
- `modifier_move`: objectId/modifierId，direction 为 -1/+1，或 beforeId（null 放最后）。
- `modifier_remove`: objectId/modifierId。
- 上述命令可加 `sourceFeatureId` 编辑基础来源的布尔栈。
- 对象 input 可加 `projection:'outline'`，只引用外轮廓、填平内孔；默认 surface 保留孔洞。
- 局部 paint/height 仍用 `cellKeys` 和 inspect 返回的 revision，作用于生成该区的样式记录。
- 保存后重新打开，栈和引用完整恢复；源曲线调整后重新计算。错误卡片可停用或删除以恢复有效输出。
