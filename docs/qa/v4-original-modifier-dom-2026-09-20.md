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
