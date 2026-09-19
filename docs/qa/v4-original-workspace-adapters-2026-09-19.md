# 原工作区适配与迁移模块检查 · 2026-09-19

分支：`codex/editor-model-v4-plan`。这是阶段证据，不是 V4 默认入口签收。原 Studio 布局、样式与默认编辑状态保持；V4 尚未接管父级工作区。

## 验证结果

`pnpm check:all` 通过：69 个单元测试、全库 typecheck/lint/format、Rust format/check、Web 和桌面前端生产构建。测试涵盖原创作组件可选运行时、稳定源身份与坐标转换、预览逐次版本、制造配置投影、动态多连通面、路径组、双向拖柄及迁移容器往返。本地日志：`outputs/v4-qa/check-all-source-ownership-2026-09-19.log`。代码检查点为 `4b2af4c`，之后仅更新任务与 QA 文档。

额外执行并通过：

```sh
node scripts/tests/unit/test-v4-legacy-equivalence.mjs F:/Projects/Splinelet/output/agent-emblem/sandrone-gold-emblem.spl
```

后续唯一源修复后，内置 Sandrone 的 69 个区域、gold 的 70 个区域与旧引擎对齐；最大对称差面积为 `0.000120307128152705 mm²`。内置原始 cubic 对比覆盖 569 段，gold 覆盖 575 段，容差 `1e-9 mm`。逐区域颜色、厚度、分层模式与 Z 对齐；局部来源编辑后的区域、重叠分区、孔洞及 gold 镜像/阵列/连接构面通过动态断言。

两份迁移结果均通过 `encodeDocument` → `decodeDocument` 后 document/assets 全等。紧凑内部 ID 保留完整 idMap/report 和输出合同，没有放宽 16 MiB 限制。对同一原件重复导入得到相同 document/idMap。

源语义补充检查：76/79 条原路径各自只有一个可写来源；共享外轮廓的 10 个消费者通过外部引用随源顶点更新，完整依赖图无环。47/48 个 smooth 节点映射为 Path.handleModes，并通过双向拖柄保长测试。11 个路径组保存精确成员与顺序，头饰组保持原 9 条路径。动态封口改为 Path straight closure，隐藏零边标记已移除。布尔残屑使用原有效区域阈值 `1e-7 mm²` 过滤，并有保留有效小区域的测试。

原 UI 双端打开、选取、厚度编辑/撤销与截图证据见[恢复快照](studio-ui-restoration-2026-09-19.md)。该浏览器结果验证原默认后端，不是 V4 GUI 或原生文件对话框验收。

后续源操作检查点 `f209aba`：`pnpm check:all` 再次全通过，包含 72 个单元测试、类型/lint/格式、Rust format/check 与双端前端构建。本地日志为 `outputs/v4-qa/check-all-path-intents-2026-09-19.log`。新增验证覆盖共享节点批量 Preview 与单次撤销、精确头尾续画、拟合闭合和 Fill 同步撤销、迟到拟合拒绝，以及路径名称/显示的批量原子修改。仍未把这些适配全面接入原父级工作区。

单节点检查点 `6f2469a`：`pnpm check:all` 全通过，包含 74 个单元测试及全部类型/lint/格式、Rust 和双端构建。本地日志 `outputs/v4-qa/check-all-single-vertex-path-2026-09-19.log`。首点创建、像素显示/移动、容器重开、头尾续画与逐次落点撤销保留同一 Vertex；复制与跨部件转移维护共享引用闭包，旧 V1–V3 单点路径也能导入。原画布的事件接线仍待完成。

## 未完成项

路径拓扑检查点 `e1c5c26`：本轮 `pnpm check:all` 通过，含 77 个单元测试、Rust 检查与双端构建，日志 `outputs/v4-qa/check-all-path-topology-2026-09-19.log`。最终核对后将直连控制柄修正为原 `straightCubic` 的三分之一位置，并重跑几何命令/像素意图两组测试及全库 typecheck/lint/format，均通过。删除计划保留共享几何及可修复引用，列出传递下游影响；重拟合保持拓扑与端点身份，坏路径仍可改名/删除。原节点删除、合并和工作区接线仍待完成。

- 原工作区的文件、历史、源手势、构造和模型面板尚未全面接入 V4。
- 真正含混的多 owner 声明结构化拒绝；尚无曲线集合算子时，跨 owner 多曲线 between/split 也拒绝，不复制来源兜底。两份指定工程没有这些情况。

以上限制阻止 T18 和默认切换签收，不能由初始几何相同或本次检查通过来豁免。后续执行边界见 [P02](../../tasks/editor-model-v4-refactor/02-document-and-persistence-2026-09-19.md)、[P06](../../tasks/editor-model-v4-refactor/06-editing-runtime-and-api-2026-09-19.md) 和 [P07](../../tasks/editor-model-v4-refactor/07-editor-experience-2026-09-19.md)。

## 原件保护

前后 SHA256 均一致：内置文件 `0997DD9A6D41AE21DEF3E1555C0BE4286668A29F4273FA4E9758C188CC883A86`；本地 gold 文件 `DB86281E03037A187E27D8F15AE8E13EB0F4E7B8CF6887CAC120BD149815BB4E`。两份原件未被保存测试覆盖。
