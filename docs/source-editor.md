# 源线编辑器与兼容 API

源线编辑是统一创作中的工具能力，不再作为“更多”中的独立工作台。日常构面、分色与分层流程请先阅读 [项目首页](../README.md)。

## 编辑器的层级

以下说明适用于选择源线，或切换到描线、节点工具时显示的工具属性。统一创作的作品树、工程设置、选区属性与制作导出见 [统一创作指南](creation-2026-09-19.md)。

右侧工具区显示路径树、当前路径和节点所需的操作。属性栏竖排按“工具 / 工程 / 选区”分组，当前按钮向右与内容区连成一个面板；没有选择时“选区”整组隐藏。工程设置、项目色卡、打印方案与制作导出位于独立的“工程”分类，不再嵌套在源线属性中。选择源线时只有“选区 → 属性”，不会显示作用于所属部件的构造修改器。只有工具决定画布操作；查看属性不会偷偷改变工具。

| 工具       | 点击                                  | 拖动                                           | 双击                 |
| ---------- | ------------------------------------- | ---------------------------------------------- | -------------------- |
| 选择 V     | 选择整条路径；Shift / Ctrl 增减       | 空白框选相交曲线；拖过线条不移动形状           | 曲线进入节点编辑     |
| 节点 A     | 选择当前路径的节点；Shift / Ctrl 增减 | 空白框选节点；选中节点一起移动；单个控制柄调形 | 曲线主动插入一个节点 |
| 描线 P     | 沿底图落点                            | 移动鼠标预览下一段                             | 使用单击确认落点     |
| 移动对象 H | 面或线选择所属部件；修饰键增减部件    | 拖动选中部件的全部源线，保持内部相对位置       | 空白不移动对象       |

节点模式编辑当前一条路径中的多个节点；Ctrl+A 全选其节点后可整体移动这条路径。选择模式不移动形状。H 切换到移动对象，将当前区域或线条选择提升为所属部件；未选部件第一次按下只选中，松手后再次按住才可拖动；拖动已选部件保留多部件选择，整体移动全部来源。按住 Shift / Ctrl / Cmd 点击只增减部件，拖动开始后按 Shift 限制水平或垂直方向。隐藏路径可以在路径树中管理，但不会被画布框选。

- Ctrl+A：画布选择模式全选可见路径；节点模式全选当前路径节点；路径树中全选路径。
- 框选遇到的曲线会入选，不要求整条曲线完全在框内。Shift / Ctrl 框选追加。
- 节点移动达到 4 个屏幕像素才视为拖动。拖动开始后按 Shift 限制水平 / 垂直方向。
- 单击或未超过阈值的抖动只选择；拖动在松手时立即结束。失焦、指针取消或捕获丢失会恢复原位置，不产生撤销记录。
- 单次拖动只产生一次撤销记录。Esc、指针取消或窗口失焦恢复原位置。拖动中暂停浏览器草稿保存，松手后保存最终结果。
- 空白单击清除当前层级选择；节点模式保留正在编辑的路径。Esc 依次取消当前操作、节点选择、路径选择。
- Delete / Backspace 仅在节点工具删除已选节点；选择工具不会通过快捷键删除源线。整条路径的删除使用明确的路径操作入口。
- Ctrl+Z 撤销，Ctrl+Shift+Z 重做。滚轮围绕鼠标缩放；右键、空格拖动或中键平移。描线时右键短点结束当前线，右键拖动只平移视图。

## 端点吸附与对称接缝

节点工具 A 默认开启「端点吸附」和「保持已有对称接缝」，可在节点属性中分别切换。单独拖动开放路径的头尾节点时，可吸附到可见路径的自由端点，以及所属部件经曲线镜像、旋转阵列得到的自由端点与对称接缝。已经接合的端点不会作为目标，避免额外接入形成分叉。

选中端点后，淡色虚线显示由当前修改器计算出的对称接缝；拖近后显示青色辅助线、落点和吸附提示。吸附在 10 个屏幕像素内进入，离开 16 像素后释放，缩放不会改变屏幕上的操作距离。原本位于对称接缝上的端点默认沿接缝滑动，因此调形时仍与自己的镜像或相邻阵列副本接合。已有断口可以拖近辅助线重新接合，不需要手工输入完全相等的坐标。

按住 Alt 暂时解除吸附和接缝保持；按住 Shift 使用原有水平／垂直约束并暂停吸附。控制柄、内部节点和多选节点仍使用原来的移动方式。吸附同时平移端点与相邻控制柄，不添加闭合段、不合并源路径，也不改变尖角／平滑类型；一次拖动只产生一次撤销记录，Esc 取消整次拖动。

接缝保持根据每次拖动开始时的曲线与修改器推导，不是另存一套永久约束。修改器参数改变后辅助线随之重算；不合规的分叉或其他拓扑错误仍通过派生样条预览与构面诊断显示。`state.nodeSnapping` 返回 `{enabled, keepSeams, target}`，用于读取当前交互状态；精确样条 API 仍直接应用传入坐标，不隐式吸附。

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

Enter / 右键 / Esc 结束，C 或点击另一端闭合。路径页选择“从头续画 / 从尾续画”，或点击画布头尾标记；节点模式可双击开放端点，也可单选端点后按 E。续画只增加新段，不反转或重拟合原曲线；L 修正当前续画方向最新的一段。节点模式可批量设为尖角、平滑（共线）或对称（等长共线，C1 连续）。开放端点只有一侧曲线，不能设置连续模式。只单选一个节点时显示它的控制柄，多选移动保持各节点与柄的相对位置。节点详情明确列出前后相邻段，路径删除和重新拟合收在“路径操作”中。

画布底部色卡只选择画笔色。要编辑或删除项目色，打开“工程 → 色卡”。未使用颜色直接删除；已使用颜色需选一个替换色后删除，原有形状、厚度和源线保持不变。替换与删除共一次撤销；工程至少保留一种项目色。

删除中间节点会将相邻两段近似合并成一段，不新增中间节点，其他未受影响的段保持原样。删除开放端点移除相邻段。闭合接缝只算一个节点；删到最后一个节点时移除路径。节点模式中单选开放端点后按 M，再选另一条样条蓝色端点合并。合并保持原段形状，必要时反向；不重合端点间加一段直连，精确重合则焊接。

## 保存与导出

Ctrl+S 或“保存工程”首次选择并绑定工程文件，之后每次按下 Ctrl+S 或点击按钮才写回同一文件；Ctrl+Shift+S 另存为。编辑不会自动写工程文件。浏览器不支持文件选择 API 时，保存会下载工程 JSON，浏览器草稿仍用于恢复。

浏览器草稿约 200ms 提交，事务完成后才显示成功，并始终显示为“未保存工程文件”或提示按 Ctrl+S。文件写入串行，失败中止，不将旧写入覆盖新内容。刷新后恢复工程和文件关联；恢复的工程也须由用户再次按 Ctrl+S 才会写文件。导入新底图 / API 载入工程解除旧文件绑定，避免覆盖旧工程文件。

“工程 → 导出”导出通用 3MF、分色 SVG、精确源曲线 SVG，以及包含最终实体和源贝塞尔的 Blender 脚本；先选择需要输出的零件。STL 保留在兼容 API 中。源曲线 SVG 保留所有可见路径及分组。毫米尺寸按整张底图计算；Blender Python 在 Scripting 打开并运行，创建新的集合，不删除已有场景。具体差别见 [统一创作指南](creation-2026-09-19.md)。

## 原图像素兼容 API

默认入口为 [Agent API 5](agent-api-2026-09-20.md)。下列兼容源命令仍使用原图像素，写入必须携带 document.get 读取到的 expectedRevision；不能在提交时补取当前修订来覆盖原读版本。HTTP 配套接口为 POST /command，body 为 `{action,args}`；WebMCP 使用同一动作和修订约束。

```javascript
const call = window.traceStudio.call;
const observed = await call('document.get');
await call('create_path', {
  expectedRevision: observed.revision,
  name: '轮廓',
  points: [
    { x: 20, y: 30 },
    { x: 80, y: 50 },
  ],
  mode: 'ink',
  preview: true,
});
await call('commit_preview', { expectedRevision: observed.revision });
```

`create_path` 接受候选编号或点坐标，返回 fitError / needsAnchor。`manage_group` 支持 create / rename / assign / visibility / delete。`move_path` 保留单条移动兼容入口；`select_path` 现在进入路径选择模式，节点编辑使用 `select_node`。`delete_node`、`merge_paths`、`straighten_span`、`get_project`、`inspect_geometry`、`undo`、`set_view`、`load_project` 保持可用。`refit_path` 仅打开确认框，不能绕过用户确认。拖动期间拒绝 API 修改工程。

注入 V4 会话的原界面中，`finish_path` 与结束按钮、Enter 使用同一完成管线：不添加曲线几何，但会将有效的待完成分区发布为一次可撤销命令。未闭合孔、无效目标等会返回错误，并保留原始线条供续画；不会仅退出绘制就报告构造成功。

同一 V4 会话中的“导出 .spl 工程副本”读取当前已提交文档及资源，生成可重新打开的完整容器。API `export({format:'json'})` 保留调用名称，但在 V4 下返回 `{filename, mimeType, base64}`，其中 base64 是 `.spl` 容器，不能当成 JSON 文本解析。导出副本不绑定文件、不清除未保存状态，也不加入撤销历史；拖动预览期间拒绝导出。SVG 与 Blender 源曲线导出入口保持原格式。

V4 会话中，源曲线导出窗口的“挤出厚度”是 Blender 脚本的导出偏好。它由会话持有，不改变作品的区域厚度、规范文件或撤销记录；设置后 `export({format:'blender'})` 使用新值。区域的实际厚度仍通过原“高低”工具和区域属性编辑。

`load_project` 接受 `{expectedRevision,project: 旧版工程对象}` 或 `{expectedRevision,base64: 完整工程容器}`，二者只能提供一个，可附带显示用 `filename`。V4 会话复用文件打开管线：旧对象正式迁移，V4 容器校验文档与资源；成功后重置历史和选区，保持无文件绑定，旧工程导入标为待保存。可以将 V4 `export({format:'json'})` 返回的 `base64` 传回此入口；不要传只读展示对象或缺少资源的裸 V4 JSON。失败保留当前工程；绘制计算、保存或拖动期间拒绝替换。

V4 的 `set_point` 保留原图像素坐标与控制柄 1/2 参数，通过当前源视图解析稳定身份，复用鼠标拖柄的命令；平滑/对称模式会按原规则联动另一侧控制柄。一次调用对应一次撤销，过期视图或受约束的非法改写不会退回旧工程写入。

V4 原源线列表的编组快捷键、`manage_group` 与 `move_paths` 使用纯路径集合。移入分组会从其他纯路径分组移出，混合实体集合不受影响；显隐显式修改当前路径成员，解散不删除路径。`get_project` 中的 groups 带 pathIds，路径的 groupIds 保留高级重叠成员，只有唯一归属时才给出 groupId。以重叠归属路径为移动目标时，需要先明确归属。编组与排序均保持单步撤销，不改变部件所有权或构造链。

## 精确样条 API 5

`spline_apply` 用于自主设计，使用类似 [Blender BezierSplinePoint](https://docs.blender.org/api/current/bpy.types.BezierSplinePoint.html) 的锚点和双控制柄数据，不调用描图、吸附或拟合。原有 `create_path` 继续用于沿底图描线。

V4 会话中的原 API 先从只读源视图解析精确提案，再在一次规范事务内执行全部曲线命令。已有路径保留 Path 身份与构造引用；辅助线不会隐式参与填充，洞作用于指定部件的当前区域。共享或关系驱动的源几何不能被整条替换，失败回滚整批。默认入口切换仍以重构任务验收为准。

```js
const call = (action, args = {}) => window.traceStudio.call(action, args);
const observed = await call('document.get');
const { pathIds } = await call('spline_apply', {
  expectedRevision: observed.revision,
  objectId,
  units: 'model',
  splines: [
    {
      name: '半边轮廓',
      closed: false,
      role: 'guide',
      nodes: [
        { co: { x: 0, y: 20 }, handleRight: { x: 5, y: 15 } },
        { co: { x: 4, y: 5 }, handleLeft: { x: 8, y: 10 } },
      ],
    },
  ],
});
const edited = await call('document.get');
const { splines } = await call('spline_inspect', { pathIds, units: 'model' });
// 修改读回的节点后可带原 id 提交；也可省略 nodes，只变换现有曲线。
await call('spline_apply', {
  expectedRevision: edited.revision,
  units: 'model',
  splines: [{ id: pathIds[0], matrix: [1, 0, 0, 1, 2, 0] }],
});
await call('creation_inspect');
```

- `units:'image'` 默认使用原图像素、左上原点、Y 向下；`model` 使用毫米、图像中心原点、Y 向上。控制点可以伸出底图。inspect 不携带图片数据。
- 节点 `co` 必填；`handleLeft` / `handleRight` 是绝对坐标，省略时收在锚点。使用自由控制柄，不自动改变形状。闭合接缝只提供一次；移动锚点可同时平移它的两个柄。
- 没有 `id` 是新建；有 `id` 必须已存在，并保留来源引用和归属。传 `nodes` 替换几何；复制可读出节点后去掉 id 提交。`objectId` 指定新线所属部件；不允许顺便转移已有路径。
- `matrix:[a,b,c,d,e,f]` 在所选单位下计算 `x'=a*x+c*y+e, y'=b*x+d*y+f`，再转存储坐标；支持平移、缩放、旋转、镜像，拒绝退化矩阵。
- 新路径 `role` 为 boundary/hole/guide；边界与洞须闭合，洞须指定部件。显式曲线流水线使用 guide 源线，避免先隐式构面。修改已有用途/归属继续使用创作命令。
- 每批 1–200 条，每条最多 1000 个节点；开放至少 2 个、闭合至少 3 个。返回 `{pathIds}` 与输入顺序一致。整批验证后一次提交，任意错误均不产生部分修改；`undo` 撤销整批。
- 两个入口通过浏览器、WebMCP `bezier_spline_*` 和本机 HTTP 共同暴露；WebMCP 也提供 `bezier_undo`。后续步骤见[曲线与面流水线](modifiers.md#添加排序与删除)。

## 验证

```powershell
node scripts/tests/unit/test-selection.mjs
node scripts/tests/unit/test-continuity.mjs
node scripts/tests/unit/test-node-edit.mjs
node scripts/tests/unit/test-connect.mjs
node scripts/tests/unit/test-extend.mjs
node scripts/tests/unit/test-swatch-delete.mjs
node scripts/tests/unit/test-single-curve.mjs
node scripts/tests/unit/test-persistence.mjs
node scripts/tests/unit/test-model.mjs
pnpm exec tsc --noEmit
pnpm build
```

浏览器注入脚本必须在隔离测试浏览器中运行，并自行建立工程或使用 `scripts/tests/fixtures/` 中已提交的最小 fixture。当前源编辑器保留 `test-spline-endpoints.cjs` 的端点续画/闭合覆盖，以及 `test-restore-race.cjs` 的恢复竞争覆盖。依赖当前页面、前序脚本状态或 OS 私有文件选择器的旧调试脚本已删除。

### V4 后端接线进度（2026-09-20）

原界面注入 V4 host 时，批量 `create_path` 已通过捕获版本的 `draw-path` 意图保存原始贝塞尔。`preview:true` 不写工程；返回 id 是临时候选标识，`commit_preview` 返回实际已提交路径 id。直接创建返回实际路径 id。候选过期不能接受，重新拟合使用原确认框并保持源拓扑身份。此项为后端接线说明，默认入口与全部 API 的 V4 切换尚未完成；当前验收见[原界面 QA](qa/v4-original-modifier-dom-2026-09-20.md)。
