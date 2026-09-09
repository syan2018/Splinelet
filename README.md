# 描迹 · 贝塞尔工作台

可在浏览器中运行的交互描线应用。图像在浏览器中处理，无图像上传服务。启动后会展示本次角色的描线工程；当前浏览器的工程优先自动恢复。

## 启动

需要 Node.js 22.13 或更高版本。

```powershell
npm ci
npm run dev
```

打开 http://localhost:3000/ 。Agent 配套服务可在另一个终端启动：

```powershell
node scripts/agent-server.mjs
```

服务只监听 127.0.0.1:4318，仅允许 http://localhost:3000 的浏览器 Origin；部署版本不会连接本机服务。不要将该端口开放到公网。同一时间使用一个本地工作台标签页。

## 交互

- 导入或拖入 PNG、JPG、WebP。最大 30 MB，超过 4096 像素的底图会缩小；分析分辨率最长边 900 像素，曲线仍使用底图坐标。
- P 描线：第一次点击创建锚点，移动显示白色虚线预览，下次点击确认沿边缘的一段三次贝塞尔；不会生成额外中间锚点。
- 深色线条偏好局部暗谷；颜色边缘偏好梯度。纯黑大区域不会仅因颜色黑而获得最低代价。
- 分岔、尖角处增加锚点。错误路线用 Ctrl Z 撤销，缩短两点间距或减小搜索范围。
- Enter / 右键结束，C 或点击起点闭合。选择路径后可以续画。
- V 编辑：方点为锚点，圆点为控制柄；拖动锚点同时更新相邻段端点，双击曲线精确插入节点。
- H 或按住空格拖动画布；滚轮缩放。
- Ctrl S 保存包含底图的完整 JSON 工程。左下文件夹打开工程。导入底图或示例可撤销。
- SVG 保留三次贝塞尔及毫米宽高。毫米尺寸按整张底图计算，不是紧包围盒。
- Blender .py 在 Scripting 工作区打开并运行，生成新集合，保留已有场景。闭合曲线填充并按设定厚度挤出；开放曲线保留可编辑路径。

## 单段约束（1.1 更新）

开放路径 N 个落点对应 N−1 段曲线；闭合对应 N 段。每段仅有两个必要的贝塞尔控制柄。拟合误差较大时仍保留单段，建议手动补点。双击插点是用户主动操作。旧示例是上一版多段拟合结果，不会自动覆盖；选中路径后点击“按原落点重拟合”可转换，支持撤销。

API 新增 refit_path({id})，与按钮相同；create_path 返回 fitError 与 needsAnchor。tolerance 现为提示阈值，不再控制分段数量。

## 节点编辑（1.2 更新）

- V 进入编辑，点击路径，再点击方形节点。金色框表示当前选中；右侧显示节点序号和坐标。
- Delete / Backspace 或右侧“删除节点”删除单个节点。未选中节点、选中圆形控制柄时不会删除路径；整条路径通过单独的垃圾桶按钮删除。
- 删除中间节点时，将相邻两段近似拟合成一段三次贝塞尔；两侧锚点不动，不增加中间节点。状态栏显示形状变化估计。其他段保持原样。
- 删除开放路径端点时移除相邻段。闭合接缝只算一个节点；剩余一个节点时变为开放路径，删除最后一个节点会移除空路径。
- 只显示选中节点相邻的控制柄；锚点和控制柄点击区域扩大。点击空白或 Esc 取消选中。单击选择不产生撤销记录，拖动超过 3 屏幕像素后才记录修改。
- Ctrl+Z 撤销、Ctrl+Shift+Z 重做。删除后更新落点记录，后续重拟合不会重新出现已删除节点。

API（浏览器、WebMCP、HTTP 配套服务均支持）：

```javascript
await window.traceStudio.call('select_node', {pathId: '路径 ID', nodeIndex: 2});
await window.traceStudio.call('delete_node', {pathId: '路径 ID', nodeIndex: 2});
```

nodeIndex 从 0 开始，表示路径的实际锚点序号；开放路径为曲线数 + 1，闭合路径为曲线数。单节点路径为 1。删除返回 nodes、segments、merged、shapeError（相对删除前两段的像素变化估计）。state.selection 返回 curve、point、nodeIndex；选中控制柄时 nodeIndex 为 null。

验证：node scripts/test-node-edit.mjs 覆盖开放首尾与中间、闭合接缝、退化到单节点、连接连续性、保留锚点和其他曲线、不修改原对象、单段合并。另有浏览器鼠标/键盘交互验证和单段拟合回归测试。

## Agent API

使用与界面相同的状态、Worker 和导出函数，无额外拟合实现。

```javascript
await window.traceStudio.call('detect_candidates', {
  region: {x:300, y:250, width:510, height:440}, limit:25, spacing:35
});
await window.traceStudio.call('create_path', {
  name:'刘海', points:['C03', {x:550,y:397}, 'C22'],
  mode:'ink', tolerance:2, corridor:50, preview:true
});
await window.traceStudio.call('commit_preview');
await window.traceStudio.call('inspect_geometry');
const {content} = await window.traceStudio.call('export',{format:'svg'});
```

候选点由图像角点响应及非极大值抑制生成。它们是视觉选择的建议，不能自动保证是正确的语义拐点。每次生成重新编号，先读取当前 candidates 再使用编号。原点在左上，x 向右，y 向下，单位为原图像素。

| 操作 | 参数 / 结果 |
| --- | --- |
| state | 底图尺寸、就绪状态、路径摘要、候选点、当前设置 |
| detect_candidates | region、limit 1–120、spacing 8–500；显示并返回带编号候选点 |
| create_path | points 2–200（坐标或候选编号）、name、closed、mode ink/edge/manual、tolerance .3–12、corridor 10–400、snap、preview；返回路径 ID、段数和边缘支持分数 |
| commit_preview / discard_preview | 接受 / 丢弃当前候选路径 |
| get_project / load_project | 读取 / 载入完整工程；load_project 参数 {project} |
| select_path | {id} 选中并进入编辑模式 |
| set_point | {pathId,curve,point:1或2,position:{x,y}}；编辑三次曲线控制柄 |
| set_view | {fit:true} 或 {x,y,scale}；x/y 是画布内平移，scale .05–12 |
| set_candidates_visible | {visible} |
| undo | 撤销上一次工程变更 |
| inspect_geometry | 返回可见路径的端点缺口及抽样自交位置；不检查不同路径之间的重叠 |
| export | {format:'svg'/'blender'/'json'}，返回 filename、content，不触发下载 |

WebMCP 以 `bezier_` 前缀注册 state、detect_candidates、create_path、commit_preview、get_project、set_point、inspect_geometry、export。浏览器不支持 WebMCP 时普通编辑功能不受影响。

本机 HTTP 服务：GET /state 读取连接和状态；POST /command，JSON 为 `{action,args}`，等待当前工作台执行并返回。最长等待 60 秒；超时后先读 state，不应盲目重复写操作。`scripts/client.mjs` 包装了这个协议。/next 和 /result 是界面内部轮询端点。

## 算法与限制

多尺度局部暗谷与 Sobel 梯度形成像素代价。A* 在两锚点扩张的边界框中搜索，并加入偏离引导线的代价；每两个用户落点固定拟合一段三次贝塞尔，固定端点，以最小二乘和迭代参数优化求解两个控制柄；不自动添加中间锚点。偏差超过 tolerance 时仅提示用户补点。使用 Worker 避免阻塞 UI；预览最多保留一个待计算请求。手动模式直接连接，之后编辑控制柄。

参考方法：[Intelligent Scissors](https://www.cs.cornell.edu/courses/cs4670/2012fa/readings/mort-sigg95.pdf)；[Graphics Gems 曲线拟合](https://github.com/erich666/GraphicsGems/blob/master/gems/FitCurves.c)。实现为本项目独立代码，不是论文算法的完整复现。

本次示例由 Agent 视觉选择引导点，通过同一 API 逐条描线，再做几何检查和局部自交修复。它是可继续加工的主要轮廓与细节描线，不是图像所有阴影、高光、颜色的精确复刻。弱边缘和密集分岔仍需要补点或人工调整。

二维轮廓无法恢复角色的真实三维体积。不同闭合区域可能重叠；本项目不会自动完成实体布尔合并、开孔或打印壁厚检查。Blender 导入脚本和 .blend 保存的是可编辑曲线，可用于后续浮雕或建模，不应直接视为已验证的可打印 STL。

## 验证

- `node scripts/test-geometry.mjs`：黑线圆弧必须绕行而非走直弦；空白图无边缘支持；拟合端点连续；de Casteljau 拆分保持原曲线。
- `node scripts/check-project.mjs`：示例端点闭合和抽样自交。
- `npx tsc --noEmit`、`npm run build`。
- 实际浏览器点击两点拟合、撤销、拖动控制柄、控制柄撤销、候选点预览与提交、SVG 下载、工程恢复、WebMCP 正常和无效参数调用。
- Blender 4.5.3 LTS 后台实际导入，核对每个对象、控制柄、闭合标记、填充网格和毫米比例。

本次结果：44 条路径，23 条闭合，693 段三次贝塞尔。示例抽样检查未发现自交或连接缺口。Blender 参数映射误差为浮点精度量级。
