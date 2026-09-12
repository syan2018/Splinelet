# 描迹 · 统一创作

作品以“头发、头饰、脸、杯子”等部件组织。一个部件可以包含多条源线和多个局部色块；画出边界后直接填色，再调厚度，不必逐个新建面和拉伸特征。平面与立体只是同一作品的两种视图。

## 一次完整创作

1. 导入底图。在右侧 `+` 新建部件，双击名称改名。选中部件后“画轮廓”，沿底图落点，`C` 闭合；每对落点仍只有一段三次贝塞尔。
2. 底部选择项目色，使用“上色”点击闭合区域。填色同时生成默认厚度的凸起。按住鼠标扫过多个区域，一次松手作为一步撤销。
3. 需要刘海、脸颊等局部分色时，在同一个部件内“画分区线”。线抵达两侧轮廓后会出现内部候选，直接给局部填色；“画挖洞线”闭合后扣除孔洞。参考线不参与构面。
4. 点击面选择局部，或在作品树选择整个部件，输入厚度或拖动高低手柄。“立体预览”保留同一选择，也可直接点击区域上色、选区调高。三维左键拖动旋转，右键拖动平移，中键拖动或滚轮缩放；空格拖动和平移工具也可移动视角。
5. 多选需要的部件，在“制作”中预览底板。调整外扩边距和厚度，检查预览后添加；所选部件依附底板顶面。取消预览不改工程。
6. 检查可打印实体，然后导出。尺寸、连通数量、退化面和非流形边由实际实体计算得出。

## 统一交互

平面主视图默认“底图”：显示参考图和源线，不叠加区域填色。顶部“叠色”以透明填色对照原图；“分色”隐藏底图并显示完整区域颜色。进入描线或节点工具会回到底图，上色工具默认使用叠色。显示切换不改变工程颜色或导出内容。

选择工具 V 在三种显示方式下都能选面。点击面、源线、作品树部件分别选择对应的区域、样条、整个部件；Ctrl 增减同类选择，Shift 在列表中连续选择。只有箭头展开部件，名称双击重命名。画布选择会展开并滚动作品树到对应条目，作品树选择会把屏外内容带回画布；F 或树标题旁的定位按钮可以主动聚焦。空白或 Esc 清空选择。

在面内拖动会移动其所属部件的源线，保持共享分界；节点工具用于单独调整分界。空格拖动或中键拖动始终平移画布，包括面覆盖区和高倍缩放。拖动中的 Esc 恢复原位置，松手后 Ctrl+Z 一步撤销。

多选区域后，单击其中一块会收回为单选，拖动则保留多选。选择工具的线条命中范围贴近实际线宽，方便点击杯沿等窄区域；节点工具仍保留较宽的线条命中范围。三维重叠面按实际深度与共面显示顺序选择，平移、旋转不会改变选区。

“颜色与高低”详情显示当前区域的实际颜色。下拉选择项目色会直接用于当前选区；也可输入 HEX 或使用色盘，再点“应用”。自定义颜色和填色是一步撤销，不会修改其他引用同一项目色的区域。底部色卡负责画笔色；“修改项目色”才会联动所有使用该色卡的区域。

带状面可通过 `between.boundaryRegionId` 指定父面，沿父面外环的短弧封口；`boundaryJoinMM` 限定端点到父边界的最大接合距离。源样条节点不变，轮廓移动后会重新计算；无法接合时给出具体距离。`creation_inspect.closures[].coordinates` 返回完整封口弧线，供高亮检查。

“线条”属性中的“分区补边”会指出悬空端点及缺口大小。预览只显示橙色虚线，接受后才能构面；可移除全部补边或取消某个端点的补边。旧带状面的直线封口在“构面封口”中单独列出，可查看来源、取消封口与对应面、恢复。取消封口不会删改源样条。

“全部线条”可以隐藏其他辅助源线，选中的源线始终显示。作品树中的“线”表示尚未填色的源样条，“区”表示已填色区域；开放曲线本身不会自动生成一个色块。选画笔色和普通选择也不会执行上色。

| 位置       | 操作                                                     |
| ---------- | -------------------------------------------------------- |
| 作品树名称 | 单击选择；Ctrl 增减；Shift 连选；双击改名                |
| 左侧箭头   | 单独负责展开 / 折叠，不通过点名称展开                    |
| 部件内部   | 线条和局部区域收在部件下，区域有编号和颜色提示           |
| 拖动部件   | 多选一起调整列表顺序；不改变物理 Z 高度                  |
| 拖动线条   | Ctrl 多选后批量移入另一个部件；一步撤销                  |
| 空白 / Esc | 清除选择；有操作草稿时先取消草稿                         |
| 颜色与高低 | 当前局部或整个部件的填色、厚度；位置与依附收在折叠项中   |
| 线条       | 原有描线参数、节点、连续性和拟合属性                     |
| 制作       | 底板预览、真实实体检查、导出；高级构造和制造参数折叠收纳 |

右侧边界可左右拖动，双击恢复宽度；较小窗口把属性区放到画布下方。颜色切换和选区有轻量反馈，系统减少动画设置会关闭过渡和视角阻尼。

拖动高度只显示草稿，松手提交一次，Esc / 失焦取消。数字输入 Enter / 失焦提交，Esc 恢复。Ctrl+Z 撤销，Ctrl+Shift+Z 重做。几何更新期间拒绝使用旧候选，避免填到已经变化的区域。

## 颜色与关联区域

底部色卡是整个工程共享的颜色。点击选择画笔色，双击或在属性中展开“修改项目色”编辑名称和色值；引用该色卡的区域一同更新。给单个区域换色只改变它的引用。源路径的辅助线颜色不作为作品填色。

新建分区时，子区域继承原来的颜色和厚度。保持分区结构的拖线编辑按一对一区域对应保留样式；若合并了不同颜色或高度，合并区域显示冲突条纹，必须选择保留的样式才能导出。无法映射的旧填色会明确报错，不静默丢弃。

分区线没有接到轮廓时，可预览小间隙补边；橙色连接只属于派生几何，确认后才使用，取消不改线条。不会移动源锚点，也不会把采样点加进源样条。

旧构面工程首次进入时，按分组和来源关联呈现部件，不重写源线或建模步骤。已有普通拆分面可通过“画分区线”转为部件内部的连续分区流程，旧样式保留。桑多涅测试中，11 块刘海已按此方式继续局部编辑。

已有不同高度基准、被其他体块依附、或带切削操作的旧构造需要在高级构造中整理。已经局部填色的原生部件不能任意抽走一根分区线；拖移全部来源时须保持一致高度基准。这样的操作会给出原因，避免整理列表意外改变成品。

## 工程、导出和精度

工程在第一次创作编辑后保存为 version 3，兼容读取 v1 / v2；元数据记录部件、色卡、填色范围和高度关联。继续使用同一份浏览器备份和绑定文件，Ctrl+S 写回原绑定文件，Ctrl+Shift+S 另存为。自动恢复不会每次下载一个 JSON。

- **分色 SVG**：导出可见的已填色区域，包含孔洞和毫米尺寸；派生边界为按精度采样的轮廓。精确三次贝塞尔 SVG 在“更多 → 源线工作台”的导出中。
- **打印 STL**：毫米单位，只允许通过实际检查的单个连通闭合实体；STL 不保存颜色。
- **Blender**：Python 脚本生成最终实体和独立隐藏集合中的精确源贝塞尔。成品实体为单一材质；项目颜色保存在工程和分色 SVG 中。脚本在 Blender 的 Scripting 工作区运行。

立体视图是带颜色的分区挤出预览，用来编辑外观；最终实体另外执行三维布尔和制造检查。高级切削效果以实际实体检查 / 导出为准。当前不提供多色 3MF、圆角、斜面或自动最小壁厚分析。

JSTS 构面与 Manifold 实体计算在 Worker 中执行。默认贝塞尔采样精度 0.015 mm。可选制造清理与 STL Float32 精度整理只作用于派生实体，处理后再次检查流形性；源样条不变。

## Agent API 4.0

浏览器 `window.traceStudio.call(action,args)`、WebMCP 的 `bezier_` 工具和本机 HTTP 配套服务支持相同入口。源线 / 高级构造 API 继续兼容。更新代码后重新启动已运行的配套服务以载入新增命令。

```javascript
const call = (action, args = {}) => window.traceStudio.call(action, args);
await call('creation_view', { view: 'flat' });
let scene = await call('creation_inspect');
// 返回 creation.objects / swatches、cells、errors、topologies 和 revision。
const object = scene.creation.objects.find((o) => o.name === '头发');
await call('creation_focus', { objectId: object.id });
// 可结合候选几何和画布视觉选择 cell.key，而非依赖不稳定的数组序号。
const cell = scene.cells.find((c) => c.objectId === object.id && !c.conflict);
await call('creation_select', { cellKeys: [cell.key] });
await call('creation_command', {
  action: 'paint',
  revision: scene.revision,
  args: { cellKeys: [cell.key], swatchId: 'brown' },
});
scene = await call('creation_inspect');
await call('creation_command', {
  action: 'height',
  revision: scene.revision,
  args: { objectIds: [object.id], heightMM: 1.5 },
});
await call('creation_view', { view: '3d' });
const report = await call('creation_export', { format: 'check' });
const svg = await call('creation_export', { format: 'svg' });
```

`paint` / `height` 必须使用最新 `creation_inspect` 返回的 `revision`，缺省或过期会拒绝执行。每条修改命令产生一次撤销记录；导出 API 返回数据，不触发下载。

`creation_command` 还支持 `new_object`、`object`、`swatch`、`move_paths`、`roles`、`reorder`、`continue_partition`、`combine_objects`。`roles` 参数为 `{objectId,pathIds,role}`，用途为 `boundary / divider / hole / guide`；`move_paths` 使用 `{pathIds,objectId}`；`object` 使用 `{id,changes}`。完整工具描述见 `lib/creation-api.ts`。

补边接口：`join {objectId,joinMM}`，其中 0 移除全部补边；`connection {objectId,pathId,endpoint:0|1,disabled}` 禁用或恢复单端点；`remove_connection {objectId,featureIds,disabled}` 停用或恢复旧带状面封口。`creation_inspect` 返回 `diagnostics`、`connections` 和 `closures`，后者含源路径、构面 ID 与禁用状态。`state.creation.selection` 是唯一语义选择 `{kind:'object'|'path'|'cell',ids}`。

选择与同步逻辑集中在 `components/use-creation-selection.ts`；画布坐标、缩放和定位在 `public/canvas-gestures.mjs`；构面封口/补边面板在 `components/creation-connections.tsx`。源编辑器只接收选择的路径投影；portal 面层明确转交主画布的平移手势。几何命令不依赖显示方式。

## 验证

`node scripts/test-creation.mjs` 测试区域继承、颜色与高度、合并冲突、补边预览、孔洞、整体移动、缩放、底板依附及真实实体。已有桑多涅试验副本时另验证旧工程迁移、11 块刘海转换前后体积一致、改厚度后的 STL 精度及源线不变。

`scripts/test-creation-browser.cjs` 导出一个接收 Playwright `page` 的异步函数，会替换隔离测试浏览器的工程，自行建立测试夹具。第二个参数可传 `{outputDir}`。覆盖真实鼠标扫色、拖动高度、Esc、撤销、底板预览、三种文件下载以及刷新恢复。人工补充验收和已知边界见 [CREATION-QA.md](CREATION-QA.md)。
