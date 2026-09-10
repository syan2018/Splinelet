# 描迹 · 贝塞尔工作台

用于沿参考图交互描线、建立关联区域，并把区域拉伸成简单的 3D 打印浮雕。底图和几何在浏览器内处理，支持 SVG、Blender Python、STL 和包含底图及建模步骤的工程文件。当前浏览器有工程时优先恢复。

新增 **描线 → 构面 → 浮雕** 三个工作空间。构面与浮雕的操作、精度、Agent API 3.0 和验证说明见 [MODELING.md](MODELING.md)。旧描线 API 保持兼容。

## 启动

需要 Node.js 22.13 或更高版本。

```powershell
npm ci
npm run dev
```

打开 http://localhost:3000/ 。可选 Agent 配套服务：

```powershell
node scripts/agent-server.mjs
```

配套服务监听 127.0.0.1:4318，仅接受 localhost:3000 的浏览器 Origin。当前工作台使用一个标签页；云端页面不会连接本机服务。

## 编辑器的层级

右侧上半部固定显示路径树，下半部是工程、描线、路径和节点属性。切换属性页不隐藏路径树。只有工具决定画布操作；查看属性不会偷偷改变工具。

| 工具 | 点击 | 拖动 | 双击 |
| --- | --- | --- | --- |
| 选择 V | 选择整条路径；Shift / Ctrl 增减 | 空白框选相交曲线；已选曲线整体移动 | 曲线进入节点编辑 |
| 节点 A | 选择当前路径的节点；Shift / Ctrl 增减 | 空白框选节点；选中节点一起移动；单个控制柄调形 | 曲线主动插入一个节点 |
| 描线 P | 沿底图落点 | 移动鼠标预览下一段 | 使用单击确认落点 |
| 平移 H | — | 拖动画布 | — |

节点模式编辑一条路径中的多个节点；多条路径一起移动使用选择模式。隐藏路径可以在路径树中管理，但不会被画布框选。

- Ctrl+A：画布选择模式全选可见路径；节点模式全选当前路径节点；路径树中全选路径。
- 框选遇到的曲线会入选，不要求整条曲线完全在框内。Shift / Ctrl 框选追加。
- 移动超过 4 个屏幕像素才视为拖动。拖动开始后按 Shift 限制水平 / 垂直方向。
- 单次拖动只产生一次撤销记录。Esc、指针取消或窗口失焦恢复原位置。拖动中暂停自动保存，松手后保存最终结果。
- 空白单击清除当前层级选择；节点模式保留正在编辑的路径。Esc 依次取消当前操作、节点选择、路径选择。
- Delete / Backspace 根据当前层级删除路径或节点；未选节点时不会顺带删除整条路径。
- Ctrl+Z 撤销，Ctrl+Shift+Z 重做。滚轮围绕鼠标缩放；空格拖动或中键平移。

## 路径树

- 单击名称选择，Ctrl 增减，Shift 按当前可见列表连续选择；上下方向键移动选择。
- 仅左侧箭头展开 / 折叠。分组名称选择组内路径，复选框增减整组选择。
- 分组和路径名称双击修改。路径也可按 F2。Enter / 失焦提交，Esc 取消；改名是一次撤销操作。
- 拖动任一选中路径会带上整个选择集。组标题是移入组尾；行上半部插入前面，下半部插入后面。拖动提示显示数量和目标线；折叠组在悬停后展开，放入后保持展开。
- 批量移动保留路径树的相对顺序。Ctrl+G 将所选路径编组；Ctrl+Shift+G 移到未分组。没有选择时新建分组创建空组。
- 显示控制和解散分组位于右侧。解散只移出组内路径，不删除曲线。隐藏路径时取消它的选择。
- 选中路径后 Enter 进入节点编辑。重拟合在路径属性底部的“高级操作”中，必须确认替换后才执行。

## 描线与节点

导入或拖入 PNG、JPG、WebP，最大 30 MB；超过 4096 像素的底图缩小。算法分析最长边 900 像素，曲线坐标仍使用底图坐标。

P 描线，深色线条跟随描边，颜色边缘跟随色块边界。每两个落点只生成一段三次贝塞尔，两个控制柄负责弯曲，不添加中间锚点。开放路径 N 个落点对应 N−1 段，闭合对应 N 段。旧工程已有的多段拟合结果不会被自动重写。

Shift 落点暂停吸附；Alt 落点不吸附、不拟合，用直连。L 把最后一段或单选节点对应段改为直连。复杂分岔可撤销后主动补点；容差只决定偏差提示，不决定自动分段。

Enter / 右键结束，C 或点击起点闭合。选择开放路径后点“续画”。节点模式可批量设为尖角、平滑（共线）或对称（等长共线，C1 连续）。开放端点只有一侧曲线，不能设置连续模式。只单选一个节点时显示它的控制柄，多选移动保持各节点与柄的相对位置。

删除中间节点会将相邻两段近似合并成一段，不新增中间节点，其他未受影响的段保持原样。删除开放端点移除相邻段。闭合接缝只算一个节点；删到最后一个节点时移除路径。节点模式中单选开放端点后按 M，再选另一条样条蓝色端点合并。合并保持原段形状，必要时反向；不重合端点间加一段直连，精确重合则焊接。

## 保存与导出

Ctrl+S 首次选择并绑定工程文件，之后写回同一文件；约 800ms 自动写入，Ctrl+Shift+S 另存为。浏览器不支持文件选择 API 时仍更新同一份浏览器备份，导出面板可下载副本。

浏览器备份约 200ms 提交，事务完成后才显示成功。文件写入串行，失败中止，不将旧写入覆盖新内容。刷新后恢复工程和文件关联；首次重新保存授权后恢复文件自动写入。导入新底图 / API 载入工程解除旧文件绑定，避免覆盖旧工程文件。

SVG 和 Blender 导出所有可见路径及分组。毫米尺寸按整张底图计算。Blender Python 在 Scripting 打开并运行，创建新的集合，不删除已有场景；闭合曲线填充和挤出，开放路径保持曲线。二维描线不会自动生成角色完整立体模型，导出曲线可用于后续建模和加工。

## Agent API 2.0

浏览器调用 `window.traceStudio.call(action,args)`；主要操作也通过 WebMCP 暴露。HTTP 配套接口为 POST /command，body 为 `{action,args}`；GET /state 读取连接状态。所有坐标均为原图像素。

```javascript
await window.traceStudio.call('state'); // tool、active、selectedPaths、selectedNodes、view、gesturing、paths、groups
await window.traceStudio.call('detect_candidates', {limit:48,spacing:30});
await window.traceStudio.call('create_path', {name:'轮廓',points:[{x:20,y:30},{x:80,y:50}],mode:'ink',preview:true});
await window.traceStudio.call('commit_preview');
await window.traceStudio.call('select_paths', {pathIds:['a','b']}); // 空数组取消选择
await window.traceStudio.call('move_paths', {pathIds:['a','b'],groupId:'g',targetId:'c',after:true});
await window.traceStudio.call('select_node', {pathId:'a',nodeIndex:2});
await window.traceStudio.call('set_node_mode', {pathId:'a',nodeIndex:2,mode:'symmetric'});
await window.traceStudio.call('set_point', {pathId:'a',curve:1,point:1,position:{x:50,y:60}});
await window.traceStudio.call('export', {format:'svg'});
```

`create_path` 接受候选编号或点坐标，返回 fitError / needsAnchor。`manage_group` 支持 create / rename / assign / visibility / delete。`move_path` 保留单条移动兼容入口；`select_path` 现在进入路径选择模式，节点编辑使用 `select_node`。`delete_node`、`merge_paths`、`straighten_span`、`get_project`、`inspect_geometry`、`undo`、`set_view`、`load_project` 保持可用。`refit_path` 仅打开确认框，不能绕过用户确认。拖动期间拒绝 API 修改工程。

## 验证

```powershell
node scripts/test-selection.mjs
node scripts/test-continuity.mjs
node scripts/test-node-edit.mjs
node scripts/test-connect.mjs
node scripts/test-single-curve.mjs
node scripts/test-persistence.mjs
npx tsc --noEmit
npm run build
```

浏览器调试脚本供 Playwright CLI `run-code --filename` 使用，必须在隔离的测试浏览器中运行，会替换测试工程：

- test-properties-layout.js：选择集、批量编组 / 拖动、框选、节点批量删除及撤销。
- test-interaction-edges.js：折叠组、插入位置、改名、隐藏、连续模式、视图保持、拟合确认。
- test-interaction-storage.js：拖动中不保存、提交后保存、刷新恢复、F2 和导出；接上一脚本的测试工程。
- test-saving-browser.js：用实际浏览器私有文件系统测试同文件自动保存、授权恢复与另存为，仅替换 OS 文件选择器。
