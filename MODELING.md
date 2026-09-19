# 构面与浮雕

这里介绍顶部“更多”中的高级构面与浮雕工具。默认的统一创作已将日常描线、分区、填色与厚度放到同一部件内，见 [CREATION.md](CREATION.md)。高级工具仍将源样条、派生面、实体特征分开保存；后两步不会增加或改动源贝塞尔节点。右侧对象树按面 / 体块切换和搜索，属性按构面 / 对象 / 制造导出分栏。

1. **建立面**：选择闭合路径，点击“预览区域”，确认后建立面。开放路径可显式补齐首尾；两条开放曲线可以围面，单条线也能按指定宽度加宽成面。
2. **拆分面**：选择一个目标面和一条或多条开放样条，设置端点接边距离。橙色连接表示派生边界将补上的间隙。点击编号区域或勾选所需候选，Enter / 按钮提交；Esc 取消。端点接边只影响构面，不移动源节点。
3. **布尔操作**：选择目标 A 和工具 B，支持并集、相减、交集。相减保留 A 中不属于 B 的部分，支持孔洞。输入面仍然存在，可继续编辑或隐藏。
4. **拉伸**：选择一个或多个面，点“添加为凸起体块”。体块可以使用绝对 Z，或依附同一零件中另一个凸起的顶面。厚度改变会传递到依附体块。凹槽从起始 Z 向下切，贯穿切穿当前零件。同一零件先合并全部凸起，再扣除全部切削；不同零件独立。
5. **导出**：浮雕的制造 / 导出面板显示实际尺寸、连通数量、非流形边和退化面。STL 只导出一个有效相连的闭合实体，坐标单位为毫米。Blender Python 包含独立隐藏集合中的所有源贝塞尔和最终实体；在 Blender 的 Scripting 中运行。面 SVG 包含派生轮廓和孔洞，源贝塞尔 SVG 仍在描线的导出中。

面和体块名称双击修改，单击只选择。画布 Shift / Ctrl 增减面选择；对象树 Shift 连选，Ctrl 增减。空白 / Esc 取消选择。侧栏可以拖动宽度。删除上游面或体块时，存在下游依赖会显示二次确认；整次操作一步撤销。

源线修改后会重算派生区域。分区数量改变，或原区域定位点不能唯一定位时，该面明确失效，需使用“重新指定来源 / 选区”修复；不会悄悄换成另一块区域。修复已有面保留对象 ID 和下游引用。改变预览参数或工程会使旧预览失效。

高级建模数据使用 version 2；加入统一创作元数据后使用 version 3，仍可打开 version 1 / 2 文件。所有建模定义随现有浏览器备份及绑定文件一起保存；无需每步另存 JSON。旧版 App 不支持新增建模数据，请用新版打开。

## 计算精度与范围

构面使用 JSTS 平面拓扑；源贝塞尔按毫米精度自适应采样，默认 0.015 mm。三维布尔使用 Manifold WASM，在 Worker 内计算。采样点和三角网格不是新增的可编辑样条节点。

制造清理默认关闭；可预览开启 0.02 mm 清理以处理极小缝隙和零宽接触。清理会改变派生细节，需检查结果。导出会去除共面特征分界和浮点坍缩面，然后重新校验实际 STL 坐标。当前未实现圆角、斜面、自动最小壁厚分析或完整的自由曲面建模；统一创作与高级构面工作区均可导出保留分色实体的通用 3MF。

## Agent API 3.0

通过 `window.traceStudio.call(action,args)`，WebMCP 的 `bezier_` 工具，或现有 HTTP 配套服务调用。描线坐标仍为图像像素；构面几何坐标是以图像中心为原点、Y 向上的毫米坐标。

```javascript
const call = (action, args = {}) => window.traceStudio.call(action, args);
await call('set_workspace', { mode: 'faces' });
await call('preview_region', { kind: 'path', pathId: 'source-path-id' });
const {
  regionIds: [base],
} = await call('commit_region_preview', { indices: [0], name: '底板' });

const preview = await call('preview_region', {
  kind: 'split',
  baseId: base,
  pathIds: ['open-cut-id'],
  joinMM: 0.15,
});
// 在画布中审阅编号、面积及橙色连接。indices 从 0 开始。
const { regionIds } = await call('commit_region_preview', { indices: [0, 1] });
const {
  featureIds: [bottom],
} = await call('create_relief', {
  regionIds: [base],
  heightMM: 2,
});
await call('create_relief', { regionIds, attachId: bottom, heightMM: 0.8 });
await call('validate_part');
await call('export_model', { format: 'blender' });
```

其他构面操作：

- `{kind:'difference'|'union'|'intersection',a:'region-a',b:'region-b'}`。
- `{kind:'between',pathIds:['a','b'],repair:true}`。
- `{kind:'stroke',pathId:'a',widthMM:.8}`。
- `{kind:'path',pathId:'a',close:true,repair:true}` 显式补齐开放轮廓并预览自交修复。

`inspect_model` 返回完整区域 GeoJSON 和模型定义；`state.model` 提供简要状态。`select_regions`、`set_relief`、`set_model_options`、`create_part`、`select_part`、`get_relief_mesh`、`discard_region_preview` 可用。`delete_model_object` 遇到依赖时打开确认框，不能通过该 API 跳过确认。`export_model` 返回内容或 STL 所需网格，不触发下载；原有 `export` 继续输出源线。

## 桑多涅实例与验证

`scripts/examples/build-sandrone-demo.mjs source.bezier.json output-directory` 可从用户提供的 71 路径工程建立独立例子。用户图片和工程没有放入网站资源，也不会随网站发布。

例子包含 140 个有来源关联的面和 64 个体块；其中 7 条头发分界线生成 11 个区域，面部扣除嘴和眉，头饰由成对开放曲线围面，边框由外轮廓相减。成品约 80.35 × 97.32 × 4.55 mm，1 个连通实体，18,662 个三角面，非流形边和退化面为 0。保留全部 71 条源路径和 547 段三次贝塞尔。杯身尚未绘制的底图花纹没有被自动补入。

几何测试：`node scripts/tests/unit/test-model.mjs`。浏览器脚本供 Playwright CLI `run-code --filename` 使用，**只在隔离测试浏览器运行**：`scripts/tests/browser/test-model-browser.js` 验证构面、扣孔、选区、撤销、依附高度、实际下载和刷新恢复。`scripts/validation/verify-relief-blender.py` 在独立 Blender 进程中验证导出源曲线、实体和实际下载的 STL。依赖私人 Sandrone 工程的旧浏览器验收已移除，历史结论仅保留在 `docs/qa/`。
