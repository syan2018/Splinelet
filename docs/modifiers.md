# 曲线与面修改器

日常流程仍为描线 → 颜色与高低 → 立体预览。选中部件后，右侧「构造」页提供按需展开的修改器卡片；修改名称、启用状态和参数参与同一撤销与保存。默认工作区不要求用户装配节点或选择数据端口。

## 数据和计算

V4 的 Shape 保持稳定部件身份，Sketch 保存源贝塞尔，Program 保存构造算子和显式输入、输出。求值依次产生 CurveSet、RegionSet、ReliefSet、PlacedReliefSet 和 BodySet；这些结果都是只读数据。颜色、厚度、制造归属分别写入作者定义，不存在可写的 `object.modifiers`、`object.sources` 或旧 `Project.model` 第二条运行管线。旧文件只在打开时单向导入。

镜像和阵列变换精确三次贝塞尔，仅构面时按工程精度采样，不增加源节点。曲线和区域的引用明确记录来源；循环、缺失来源、断口和失效选区会报告当前错误，不回退到上一次成功几何。

| 步骤       | 输入 → 输出           | 主要参数             |
| ---------- | --------------------- | -------------------- |
| 曲线镜像   | 曲线 → 曲线           | 轴角度、中心         |
| 曲线阵列   | 曲线 → 曲线           | 数量、旋转角度、中心 |
| 构面       | 曲线 → 区域           | 填充规则与闭合边界   |
| 区域偏移   | 区域 → 区域           | 偏移距离             |
| 区域阵列   | 区域 → 区域           | 数量、旋转角度、中心 |
| 布尔、分区 | 区域及工具输入 → 区域 | 运算、明确作用范围   |

现有算子的参数由卡片显示；参数或表达式驱动的字段不会被普通数字输入框覆盖。曲线参数的中心在界面中使用世界毫米坐标，命令转换到部件局部坐标，整体移动不改写局部来源。

## 添加、排序与删除

当前「添加修改器」提供曲线镜像、曲线阵列、连接边界和闭合构面：存在明确曲线插入点时追加；存在唯一 Fill 时将曲线步骤插入其前。源曲线汇集可作为插入边界，不展开或隐式改接它的输入。区域布尔、分区、孔洞与承托使用对应任务入口，不通过不完整的通用添加表单猜测接线。

连接边界表单选择源边端和派生实例，支持每份、下一份、上一份的循环对应；连接记录和填充规则可在卡片继续编辑。Fill 只在尚无区域输出时新建，未闭合时保留诊断以便修复。标准 Fill 卡片可见，源汇集等内部节点保持在源结构中。

上下移动和删除按 Program 的真实拓扑判断。可旁路的同域线性步骤可以重接；分叉、跨域、精确区域选区或会使已有作者态输出引用失效的改动会拒绝。菜单显示每个动作的可用性与原因。一次命令失败不会留下半条构造链；结构变化只需一次撤销。

普通分区、挖洞和追加轮廓继续使用原绘制入口。底板通过引用外轮廓与偏移构造，预览仅准备命令，确认后一次提交。垂直依附与二维几何引用分别求值；打印分层和多零件只在相关业务中展开。

## 派生样条预览

画布下方「派生样条」显示只读曲线阶段；源节点和控制柄仍是编辑入口。未接合端点与分叉保留诊断，构面失败也能看到当前有效曲线。关闭辅助预览不改变工程、撤销或导出。

节点工具的[端点吸附与对称接缝](source-editor.md#端点吸附与对称接缝)继续作用于来源几何。镜像和阵列使用同一变换定义；修复端点无需扩大构面容差。

## Agent 兼容调用

先调用 `creation_inspect` 获取当前修订和 `modifierStatus`。其中 `controls` 提供可编辑参数，`structure` 提供上下移、删除的能力和原因；不能把投影修改后提交为工程。

```js
const observed = await traceStudio.call('document.get');
await traceStudio.call('creation_command', {
  expectedRevision: observed.revision,
  action: 'modifier_add',
  args: {
    objectId,
    type: 'curve_array',
    targets: { kind: 'all' },
    count: 4,
    angleDeg: 90,
    centerMM: { x: 0, y: 0 },
  },
});
```

- `modifier_add`：镜像/阵列使用 `curve_mirror` / `curve_array`，`objectId`、`targets:{kind:'all'}`、`name?`、`angleDeg?`、`centerMM?`，阵列另有 `count?`。
- `modifier_add` 还支持 `join` + `connections`（端点选项来自 `modifierAdd.endpoints`），以及 `fill` + `rule`。API 5 的 `repeat-pattern` 可一次建立整条重复构造，见 [Agent API 5](agent-api-2026-09-20.md)。
- `modifier_update`：`objectId`、`modifierId`、`changes`；按类型支持名称、启用、角度、中心、数量、偏移距离、布尔运算、接合 connections 或构面 rule。`input`、`targets`、`joinMM` 不作为普通参数写入。
- `modifier_move`：`objectId`、`modifierId`、`direction:-1|1`；不支持旧 `beforeId` 语义。
- `modifier_remove`：`objectId`、`modifierId`。

以上动作经同一 V4 会话、版本检查与事务执行。旧名称仅作为调用兼容，不恢复旧模型写回。高级构面及体块操作见[构面与浮雕](modeling-2026-09-19.md)。
