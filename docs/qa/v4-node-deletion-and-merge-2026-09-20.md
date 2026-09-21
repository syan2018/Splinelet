# V4 节点删除与路径合并验证

日期：2026-09-20。范围：原工作区适配所需的命令和像素视图意图；不构成 V4 GUI、原生文件打开或完整重构验收。

## 行为与证据

- `delete-path-vertices` 对照原 `removeNode`/`deleteNodes`：保留拟合与连续模式规则、按原索引降序处理、闭合起点旋转、单节点与整条删除。稳定 Vertex ID 和未受影响 Edge ID 保留；新的拟合边使用新 ID。被删除实体的下游引用不改绑。共享拓扑、Relation、锁定与陈旧有向边顺序在写入前拒绝。
- `merge-paths` 对照原 `mergeSplines` 的四种端点组合：保留第一条路径身份，反转边的使用方向，直桥使用原三分之一控制柄；重合端点焊接先检查共享和 Relation。只有本来同时使用两条路径的同 owner Source 才收敛成员列表，单独引用第二条的消费者保持可修复失效。
- 同部件跨 Sketch 的普通绘制路径先保持世界坐标转移，再合并；共享闭包若包含其他路径则拒绝，跨部件必须明确转移。复合命令只产生一次撤销。
- 像素视图测试覆盖变换后的源几何、稳定身份、迟到视图拒绝，以及实际两次 `draw-path` 后合并、重新求值、一次撤销恢复完整原文档。
- 临时新边 token 与真实 Edge ID 同名的回归用例，防止删除节点时错误改写未受影响的边。

新增测试：

- [节点删除](../../scripts/tests/unit/test-v4-path-node-deletion-command.mjs)
- [路径合并](../../scripts/tests/unit/test-v4-path-merge.mjs)
- [像素意图与跨 Sketch 闭环](../../scripts/tests/unit/test-v4-node-and-merge-intents.mjs)

`pnpm check:all` 退出码 0，80 项 hermetic 单元测试通过，类型、lint、格式、Rust 格式与编译、Web 和桌面前端构建通过。本地日志为 `outputs/v4-qa/check-all-node-merge-2026-09-20.log`。

## 尚未完成

原 `studio-app.tsx` 仍使用旧会话后端；本次没有更换布局、样式或默认入口。节点和合并命令已登记 API5，尚未绑定原画布事件。Collection/持久显示顺序、原文件会话、其他创作与模型操作接线及两个 Sandrone 工程的 V4 GUI 编辑保存重开仍需完成。之前原 UI 的浏览器结果只证明原 UI 保持，不能替代上述验收。

分发及后续接入见 [P07](../../tasks/editor-model-v4-refactor/07-editor-experience-2026-09-19.md)。
