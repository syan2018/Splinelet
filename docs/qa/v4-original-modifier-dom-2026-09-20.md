# 原修改器组件接线验证

日期：2026-09-20。范围：原组件接入 V4 参数及旧工作区行为回归；不是默认 V4 工作区或原生文件签收。

原 `CreationModifiers` 现在直接读取 `modifierStatus.controls`，沿用原卡片、数值输入和 CSS。构造图使用明确的 `modifierModel` 标记，不伪造旧列表、来源或作用范围。驱动值只读；缺失参数不显示默认角度或零坐标；锁定部件禁止提交。新增、删除、排序、来源和作用范围的 V4 接线仍未完成。

`node scripts/tests/browser/smoke/test-v4-original-modifier-controls.cjs` 在临时端口和全新 context 中挂载真实原组件、原样式与真实 V4 会话。实际输入 120° 后正确写入旋转部件的局部角度，原 Sketch 不变，一次撤销恢复完整 Document；启用切换、参数驱动、缺失参数和锁定均通过。测试还断言原卡片圆角和布局样式。证据：`output/playwright/v4-original-modifier-controls/result.json` 与同目录截图。此 fixture 不访问应用草稿或用户文件。

旧修改器用例曾假设 Sandrone 文件的初始作用范围为全部，实际上文件保存的是选定区域，并可能抢先读取启动工程。本次让测试等待实际文件中的修改器内容，再明确建立全部区域的撤销起点。相交运算改变拓扑时，按已有输出契约检查暂停、可见诊断及恢复原运算后的修复，不再访问不存在的旧区域。拖放测试使用足够高的 viewport 并收起参数，防止面板滚动令自动化拖起另一张卡片；原产品拖放实现没有修改。草稿状态断言同步当前文案。

以下两项均通过，每项 16 个行为断言：

```sh
pnpm test:browser --suite legacy --case modifiers --target desktop-frontend --port 4197 --output outputs/v4-qa/original-modifier-legacy-tall-2026-09-20
pnpm test:browser --suite legacy --case modifiers --target web --port 4198 --inspector-port 9258 --output outputs/v4-qa/original-modifier-legacy-web-2026-09-20
```

覆盖实际 Sandrone 的范围、撤销、启停、重命名、拓扑暂停/修复、数值取消、拖动及菜单排序、删除、嵌套构造、草稿刷新恢复和源曲线不变。两项仍运行原后端，不能据此声称 V4 全流程完成。

`pnpm check:all` 退出码 0，89 项 hermetic 单元测试、类型、lint、格式、Rust 格式与编译及双端构建通过；日志为 `outputs/v4-qa/check-all-original-modifier-dom-2026-09-20.log`。随后调整阶段提示文字及浏览器测试，重新执行双端构建、组件浏览器验证、全库 lint/格式及上述双端旧流程验证。CommonJS 浏览器脚本的 lint override 处理 Node 模块函数解构误报；产品规则不变，Worker 单测明确等待 terminate。

默认根入口仍使用原 UI 的旧后端。完整 goal 保持进行中。

## 同日补充：参考图资源与真实浏览器文件副本

`studio-presentation.mjs` 从文档 Reference 和通过大小/hash 校验的 asset bytes 创建 Blob URL，以参考图原有仿射推导原画布 frame。无图必须给出 frame，多图必须明确选择，不能显示的仿射明确拒绝；显示 URL 不写入文档或保存容器。`studio-host.mjs` 管理会话和图片资源：成功替换后释放旧 URL，失败保留原展示并释放候选资源，关闭幂等。恢复完成前发生工程替换时，候选图片也不能覆盖新工程的资源。

`studio-file-writer.mjs` 只写已经选择的目标。Web 分支检查 readwrite 授权并复用 FileWriter 的串行、close/abort；桌面分支调用已有原子写入能力。测试用注入平台能力覆盖拒绝、顺序与失败后重试，不接触真实用户文件。

浏览器中的内置 Sandrone 验证实际解码 1254×1254 图片、76 条源路径，通过原 `SplineNodeInspector` 改节点连接方式后撤销恢复。随后在独立 context 的私有 OPFS 中使用真实 `FileSystemFileHandle` 保存 V4 副本并重开：文档等价、dirty=false、Web 绑定有效、原图片 URL 释放且新图片可解码。结果为 `output/playwright/v4-original-modifier-controls/reference-result.json`，已检查截图 `sandrone-reference-reopened.png`。这是实际资源、节点组件与浏览器文件能力验证；不是完整默认工作区或原生桌面验收，未修改内置 `.spl`。

`pnpm check:all` 退出码 0：97 项 hermetic 单测及类型、lint、格式、Rust 和双端前端构建通过，日志 `outputs/v4-qa/check-all-studio-host-2026-09-20.log`。内置样例 SHA-256 仍为 `0997DD9A6D41AE21DEF3E1555C0BE4286668A29F4273FA4E9758C188CC883A86`。

## 同日补充：根会话与文件状态

`createStudioSession` 建立原工作区待接入的根会话：唯一 EditorSession、持久化会话和源/构造运行时共同发出稳定订阅 snapshot。展示 Project 由原 Studio 投影生成并由运行时签发，包含真实源路径；既不存入历史，也不写入 `.spl`。打开新文件前验证文档、参考系及可克隆输入，替换时抑制中间订阅通知，只发布完整的新状态。旧运行时关闭，旧命令不能写进新文件。

持久化打开接受实际初始 revision 和 dirty，干净 V4 文件打开后保持干净，旧工程强制未绑定且待保存。相同身份的同步和取消预览不置脏，旧 revision 或同 revision 的不同文档拒绝。`open()` 在输入克隆或校验失败时保留之前的文件状态。根控制器保存捕获真实文档版本，预览不能保存；迟到的旧文件写入不重新绑定新文件。恢复进入未绑定的修改状态；等待参考系期间的编辑或同一预览 ID 的新采样会使恢复失效。

专项测试用真实 V4 codec 校验保存字节，覆盖源拖动、订阅、撤销、完整替换、文件绑定、恢复与竞态。原组件浏览器 fixture 使用 `useSyncExternalStore` 读取根控制器，保留原修改器、节点面板和预览，验证初始干净→修改置脏→保存干净，以及真实展示路径。平台 writer 在 fixture 中为内存收集器，不访问用户文件；这不是原生保存验收。默认根和参考图资源生命周期尚未切换。

`pnpm check:all` 退出码 0，95 项 hermetic 单测、类型、lint、格式、Rust 和双端前端构建通过；日志为 `outputs/v4-qa/check-all-studio-session-2026-09-20.log`。原组件浏览器回归通过，结果在原 fixture 输出目录。此轮未改原入口 UI，双端构建产物仍为原界面。

## 同日补充：原节点面板动作接线

原主界面的连接方式、指定段直连和批量删除节点使用统一的 `node-actions.mjs` 边界；公开 API 的连接方式也走同一入口，统一清除失效的拟合误差。旧后端继续用原样条算法及事务，V4 后端只从捕获的展示句柄解析稳定源身份并提交命令。原面板 DOM、样式、选区更新和状态提示未替换。

`test-v4-node-actions.mjs` 在旋转部件及非整数比例显示坐标下对比新旧后端的曲线与节点模式，检查单次撤销、过期控制器、非法索引不提交及最后一个节点删除。原组件浏览器用例挂载原 `SplineNodeInspector`，实际选择对称模式、点击前段直连和删除，再分别撤销回同一文档；派生预览随源改变，模式/直连不移动锚点。截图 `output/playwright/v4-original-modifier-controls/source-node-inspector.png` 已检查，保留原控件与样式；fixture 中绝对定位的预览工具条限制在自己的画布容器内，避免遮盖节点控件。

这一步尚未完成主画布拖动、续画或根文件会话的 V4 切换。根会话审阅发现，当前 V4 持久化 `open()` 的初始 revision 固定为 0，随后 `update()` 会把新打开的干净文档置脏；正式接入时须让打开管线直接对齐 EditorSession 身份与干净状态，并通过真实保存/重开验证，不能靠跳过一致性检查解决。

`pnpm check:all` 退出码 0：94 项 hermetic 单测、类型、lint、格式、Rust 检查和双端构建全部通过，日志 `outputs/v4-qa/check-all-original-node-actions-2026-09-20.log`。原工作区 `spline-endpoints` 浏览器用例在 Web 与桌面前端均通过，覆盖相邻段直连、节点连接方式、删除、续画及撤销；证据分别为 `outputs/v4-qa/original-node-actions-web-2026-09-20/manifest.json` 和 `outputs/v4-qa/original-node-actions-desktop-2026-09-20/manifest.json`。使用内置 Sandrone 的 `agent-spline-authoring` 在桌面前端通过：`outputs/v4-qa/original-node-agent-desktop-2026-09-20/manifest.json`。这些完整原工作区用例仍使用旧后端，V4 的本次浏览器覆盖限于原组件接线。

## 同日补充：源编辑与构造共享会话

`source-runtime.mjs` 通过 CreationRuntime 的私有句柄表接入同一 EditorSession。源点/柄命令与路径命令复用已有稳定身份编译器，不反向转换展示 Project；手势更新始终基于捕获的起始文档，取消无历史、提交一次撤销。源视图和派生曲线读取同一预览状态。相同几何的新采样也有独立预览版本，旧句柄不能继续被读取或绑定。

`test-v4-source-runtime.mjs` 验证像素坐标与源身份、冻结参考系、基线更新、实时镜像预览、源/路径/修改器交错编辑的同一撤销历史，以及 undo/replace 后失效手势不再修改数据。此处是运行时边界验证；没有替换原 UI，也没有将原主画布手势接线记为完成。

`pnpm check:all` 退出码 0：93 项 hermetic 单元测试、类型、lint、格式、Rust 格式/编译和双端前端构建通过。日志为 `outputs/v4-qa/check-all-shared-source-runtime-2026-09-20.log`。原修改器组件浏览器回归再次通过。

## 同日补充：纯曲线阶段新增

原添加表单在可用的纯曲线部件上开放镜像和阵列。命令追加到当前曲线发布端口，保持唯一源几何，按世界坐标中心及镜像角度转换；阵列角度保留相对步进。读取能力与命令分别检查锁定、求值状态和已有区域。已有区域时拒绝简化追加，避免只改曲线而未影响区域或隐式改写复杂构造。

`test-v4-modifier-add.mjs` 覆盖真实运行时中的连续镜像→阵列接线、输出变化、原源不变、逐次撤销、错误原子拒绝、父级锁定及可添加类型投影。原组件浏览器用例新增真实表单输入：三份阵列使曲线变为三倍，输入引用指向前序镜像，中心 `(17,32)` 转换到部件局部 `(2,3)`，一次撤销恢复完整 Document。

本次 `pnpm check:all` 退出码 0，90 项 hermetic 单元测试及所有类型、lint、格式、Rust、双端构建检查通过。日志：`outputs/v4-qa/check-all-original-modifier-add-2026-09-20.log`。原组件浏览器用例通过，结果仍在上文独立 fixture 目录。

闭合构面的旧 `joinMM` 焊接及失败处理与 V4 Fill 不等价，本次明确拒绝，不默认丢弃参数。已有区域的新增、删除排序及原画布派生样条预览仍未接线；后者当前仍调用旧曲线求值器，是后续默认根工作区接入的必要依赖。

## 同日补充：原派生样条预览

`useCurvePreview` 现可从同一 CreationRuntime 同步读取 V4 当前曲线结果；不等待区域 Worker，也不调用旧曲线求值器。投影沿用原预览的世界毫米/Y-up DTO、开关、阶段选择和 SVG overlay。最终视图只读取明确发布的曲线端口，不把字典末项或其他分支的构面输入当成最终输出；blocked、empty、absent 均不回退旧阶段。阶段键包含算子和端口，避免任意文档 ID 与保留的 `final` 冲突。

端点/分叉度数根据 Edge 的共享顶点键和明确 Join 端点集合计算，不按距离推断连接。祖先隐藏同样隐藏预览；投影深冻结，不回写源。运行时只接收自己发出的当前展示句柄；相同拖动 ID 下数据更新、取消和旧句柄拒绝均有专项测试，不产生新历史。

原组件浏览器用例实际验证 SVG：镜像 2 条→新增阵列 6 条→选择镜像阶段 2 条→最终 6 条；关闭显示没有路径，重新开启恢复；参数缺失后最终路径为空，不能用成功的中间阶段冒充。`test-v4-curve-preview.mjs` 和 `test-v4-curve-preview-runtime.mjs` 覆盖坐标、拓扑、多分支、真实 Fill 输入、隐藏和实时状态边界。

`pnpm check:all` 退出码 0，92 项 hermetic 单元测试及类型、lint、格式、Rust 和双端构建通过；日志为 `outputs/v4-qa/check-all-original-curve-preview-2026-09-20.log`。阶段键补充后专项单测、组件浏览器、全库 lint/格式亦通过。默认根尚未注入 V4 会话，真实源画布拖动、完整模型/文件旅程仍未签收。
