# 曲线与面修改器

日常流程仍为描线 → 颜色与高低 → 立体预览。选中部件后，右侧「构造」页中的修改器栈提供可选的组合操作。卡片默认只展示名称、启用开关、作用范围和操作摘要；参数与基础面来源折叠。支持双击改名、拖动排序、菜单上下移动/删除，所有更改参与同一撤销与自动保存流程。

## 数据和计算

- `object.modifiers` 从上到下求值，每步声明曲线或面输入；支持镜像、曲线阵列、闭合构面，以及布尔、分区、偏移、面阵列。
- `object.sources[featureId]` 是旧工程中各基础面的来源程序：一个基础区域引用和可编辑的布尔步骤。先计算来源程序，再分区，再执行对象修改器，最后按面的颜色/厚度拉伸。
- 对象操作数引用对方的最终面结果，可多层嵌套。引用循环、丢失来源、无效边界或失效目标会报告错误，失败对象没有可导出几何，不回退到旧快照。
- 源贝塞尔节点、旧模型定义保持不变。迁移后，已提取步骤由 `sources` 管理；原模型配方保留供基础引用及兼容使用，不再是该面完整构造的第二份编辑入口。
- `roles: hole` 是创建受管差集修改器的快捷操作。迁移合并相同路径的重复减法；停用可恢复完整面，删除会将路径用途改为参考，避免隐藏减法重现。
- 面范围使用 feature/region ID、闭合边界 ID 或生成修改器输出 ID。旧分区引用附拓扑签名。丢失或歧义引用要求重新选范围，不能悄悄改到另一个面。
- 分区输出用相对有向分区线的左/右标识，颜色和厚度保存在生成修改器的 `styles` 中。下游步骤可只选其中一区。分区线必须一次贯穿单个连通面；复杂多次贯穿拆为多步。
- 引用和参数是持久数据；计算出的面、三角网格、诊断信息仅存在运行时。预览、SVG、Blender 和实体导出使用同一个实时计算结果。
- 新建底板通过引用对象外轮廓并偏移构造。其轮廓随来源更新；垂直叠放关系与二维几何引用分别求值。
- V4 承托预览只准备命令，确认后一次提交；取消不改变工程。没有项目色时会在确认的同一事务中建立默认金色。普通叠放继承来源的制造零件，跨制造零件的顶面依附需先明确归属；打印分层则插入新的最底层。

本版是 **拉伸前的曲线与面修改器**，并非 Blender 任意三维网格修改器。合并不同颜色/高度的多个面会要求先统一属性或缩小范围，避免隐式丢掉材质/高度。带修改器对象保留独立来源归属，用对象引用组合；不支持直接合并来源所有权。

## 曲线到面的流水线

统一顺序为：来源 → 有序修改器 → 输出颜色/厚度 → 分层/依附定位 → 实体检查与导出。旧工程的闭合轮廓、分区网络和高级来源 DAG 保留为“来源构面”输入适配层，不重写已有来源、样式和高度。独立曲线部件可以使用以下显式步骤：

| 类型           | 输入 → 输出 | 参数与行为                                                                                                  |
| -------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `curve_mirror` | 曲线 → 曲线 | `angleDeg` 从模型 +X 逆时针计镜像轴角度；`centerMM:{x,y}` 为轴上一点。保留原曲线并生成镜像，默认 90°、原点  |
| `curve_array`  | 曲线 → 曲线 | `count` 1–64（包括原份）；`angleDeg` 为相邻副本步进角，正数逆时针；`centerMM` 为旋转中心。默认 4、90°、原点 |
| `fill`         | 曲线 → 面   | `joinMM` 默认 0.001、范围 0–1 mm。接合派生端点，闭环后按奇偶规则构面，嵌套环成为孔；不跨断口添加直线        |
| `radial_array` | 面 → 面     | 同样的数量、角度和中心；逐个目标面复制，合并其重叠副本，继承颜色与厚度                                      |

曲线步骤读取独立部件中用途为 guide 的源样条，作用于整个曲线集合，不混合已有来源体块，不依赖当前选择。镜像/阵列变换精确三次贝塞尔，仅构面时按工程精度采样，不增加源节点；派生曲线最多 20000 段。

源线可以只画半边，再镜像、旋转，最后构面。构面前没有面输出；停用构面保留曲线程序并停止面输出。构面后放曲线操作会报输入类型错误。断口、分叉、自交或相切/交叉环暂停该部件；错误包含端点位置，修复/撤销后恢复。中心留空的纹样不会自动封上。

杯上纹样示例使用一个 1/8 扇区：内、外弧分别终止于扇区接缝上的不同位置，不在本扇区互相封口。镜像后仍不闭合，四向阵列后同类边界跨相邻扇区连接，才由构面步骤得到一个连通金色轮廓、贯通各瓣的中心空隙和四个菱形孔。内外边界的接缝都保留锐角；只在扇区内部的弧线肩部保持切线连续。

构面输出身份绑定到修改器，颜色与厚度存入已有 `styles` 机制；保持轮廓拓扑的曲线调整会继承样式。增减连通块或孔可能使已有输出约束失效，继续遵循原有构造链修复协议。`creation_inspect.pipelines` 返回阶段与输入/输出类型，`modifierStatus` 返回派生曲线段数与闭合环数。

## 派生样条预览

画布下方的「派生样条」默认开启，平面与立体页共用开关。选中曲线部件或其源线后，可在「样条预览阶段」切换源样条、镜像后、阵列后及构面输入；青线是只读派生曲线，继续拖动原有源节点与控制柄来编辑。弧线在拖动过程中即时更新，不等待区域求值完成。未接合端点以橙点标出，平面中的分叉以红点标出；端点接合判定与构面使用同一容差。

构面失败时仍显示本次源线产生的曲线和断口，不用上一次成功的面冒充当前结果。关闭预览只隐藏辅助线，不改变修改器、源路径、文件、撤销或导出。预览只展示曲线阶段；后续偏移、布尔等面操作的结果由面预览显示。

节点工具提供[端点吸附与对称接缝](source-editor.md#端点吸附与对称接缝)。修改器产生的接缝显示为辅助线；将断开的源端点拖近即可精确接合，已有接缝默认沿线保持。辅助线与实际镜像／阵列共用变换定义，修复端点无需扩大构面的接合容差。Alt 暂时解除，节点属性中可关闭吸附或保持。

`creation_inspect.curvePreviews` 保留各曲线阶段的 `{objectId, stageId, name, curves, junctions, diagnostic?}`。`curves` 是模型毫米坐标中的三次贝塞尔控制点，`junctions` 是 `{point:{x,y}, degree}` 的未接合或分叉端点列表；`stageId: 'source'` 表示来源，其他值对应修改器 ID，fill 对应其输入曲线。即使该部件的面输出因断口暂停，这些诊断仍可读取。

```js
for (const args of [
  { type: 'curve_mirror', angleDeg: 90, centerMM: { x: 0, y: 0 } },
  { type: 'curve_array', count: 4, angleDeg: 90, centerMM: { x: 0, y: 0 } },
  { type: 'fill', joinMM: 0.001 },
]) {
  await traceStudio.call('creation_command', {
    action: 'modifier_add',
    args: { objectId, ...args },
  });
  const scene = await traceStudio.call('creation_inspect');
  if (scene.errors.some((e) => e.objectId === objectId))
    throw Error('请先修复当前构造');
}
```

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
    name: '局部凹槽',
  },
});
```

- `modifier_add`: type/name/input/operation；offset 用 `distanceMM`，split 可用 `joinMM`；曲线步骤和阵列的参数见上表，不需要 input 操作数。默认 targets 为 all；可传当前 `cellKeys` 自动转换为稳定引用。
- `modifier_update`: objectId/modifierId 和 `changes`（name/enabled/operation/input/targets/distanceMM/joinMM/count/angleDeg/centerMM）；也可顶层传 targets/cellKeys。
- `modifier_move`: objectId/modifierId，direction 为 -1/+1，或 beforeId（null 放最后）。
- `modifier_remove`: objectId/modifierId。
- 上述命令可加 `sourceFeatureId` 编辑基础来源的布尔栈。
- 对象 input 可加 `projection:'outline'`，只引用外轮廓、填平内孔；默认 surface 保留孔洞。
- 局部 paint/height 仍用 `cellKeys` 和 inspect 返回的 revision，作用于生成该区的样式记录。
- 保存后重新打开，栈和引用完整恢复；源曲线调整后重新计算。错误卡片可停用或删除以恢复有效输出。
