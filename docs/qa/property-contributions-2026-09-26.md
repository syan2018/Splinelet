# 选区属性贡献验收（2026-09-26）

本次将选区属性抽为独立贡献页，派生曲线阶段选择只作用于显式选区，并澄清堆叠层混合值。架构见[属性贡献机制](../architecture/property-contributions-2026-09-26.md)。

## 通过的验证

- `pnpm typecheck`、`pnpm lint`、`pnpm test`（144 个 hermetic 单元测试模块）。新增测试覆盖贡献注册、选择类型、页签回退、无选择完整预览，以及一个 Shape 的区域分属不同堆叠层。
- `pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check`。
- 本次修改文件的格式检查与 `git diff --check`。
- `property-navigation`：独立颜色、浮雕、叠放和输出页；页签切换保留选择与文档；颜色/厚度只影响目标部件并可单步撤销；切换对象清除输入草稿；同一部件跨层与多部件跨层显示不同状态，统一赋层及撤销正确；各层保留“部分区域”成员并禁止按空层删除。
- `object-move-pipeline`：未选择时无阶段控件或端点标记；选择中间阶段、关闭派生曲线后取消选择，均恢复完整结果；预览不编辑文档，原有移动与撤销断言通过。
- `scene-group-selection`：组/部件混选、嵌套组去重、解组和剩余选择正确。
- `original-studio`：原 Studio、真实 Sandrone 区域样式、源编辑、承托、撤销、保存、V4/旧工程/样例打开和无效文件保护。
- `vector-transform`：SVG 导入、笔画宽度、变换及撤销，确认新的属性导航保留前一轮笔迹导入修复。

以上浏览器测试使用独立端口与全新的 browser context。桌面静态前端验证不等于 Tauri 原生文件会话验证。本机证据目录（仅属于本次运行）：

| 案例                                    | `outputs/v4-qa/` 下目录                   |
| --------------------------------------- | ----------------------------------------- |
| property-navigation（桌面前端）         | `2026-09-26T08-29-52-234Z-48088-d5abefaa` |
| property-navigation（Web 生产构建）     | `2026-09-26T08-32-06-598Z-54340-f1206705` |
| object-move-pipeline（桌面前端）        | `2026-09-26T08-20-48-651Z-45904-63a42039` |
| scene-group-selection（Studio fixture） | `2026-09-26T08-24-59-706Z-52756-87fa4cff` |
| original-studio（Studio fixture）       | `2026-09-26T08-24-59-711Z-51496-3a914920` |
| vector-transform（桌面前端）            | `2026-09-26T08-30-17-867Z-53900-2f13d3d4` |

## 未通过的检查与范围限制

- `pnpm format:check` 报告 350 个文件问题，包含未修改文件的既有换行格式问题；未进行全库格式重写。
- `selection-scope` 在 `target && !target.painted` 旧候选区域断言处失败，尚未进入本次属性页修改。证据：`2026-09-26T08-22-28-677Z-44256-37e7fb16`。
- `spline-endpoints` 使用旧输入路径 ID 调用 `select_path`，报“路径不存在”。证据：`2026-09-26T08-24-59-711Z-56204-152b9bcd`。
- `hair-partition` 等待旧输入路径 ID 对应的大纲行超时，尚未进入属性编辑。证据：`2026-09-26T08-24-59-710Z-22128-914b6f10`。
- 以上旧用例的页签名称已同步，但没有删除或放宽原几何断言；不能记为通过。独立 `sandrone-restored-ui` 依赖本机补充文件，本次未运行；使用原 Studio fixture 完成承托等相关路径验证。
