# 合并与变换界面验收：2026-09-26

## 起始状态与处理

本地 `main` 停在合并 `a63b92c` 的过程中；本地父提交为 `fcc0a11`。冲突涉及 `scripts/README.md`、`scripts/tests/unit/test-v4-compare.mjs` 和 `src/components/studio/studio-app.tsx`。

保留本地 SVG 导入、整组变换与远端独立参考图图层。拖入 SVG 打开矢量导入对话框；批量拖入 PNG、JPG、WebP 添加参考图，保留已有工程。基线哈希继续统一文本换行后计算。

## 变换界面

左侧入口统一为「变换」，点击默认进入移动，并展开移动、旋转、缩放按钮。G / R / S 直接进入对应模式，移除 H。右侧同步显示模式、快捷键、当前选区、数值输入及拖动说明；在变换工具页换选对象保留该页。矮窗口压缩工具区并减少大纲高度，为数值输入留出空间。

本次没有改变变换几何语义：缩放仍为等比缩放，厚度保持不变。当前使用方式见[源编辑器指南](../source-editor.md#整组变换)。

## 验证

- 140 项单元测试通过；调整浏览器案例适配后另行通过 `test-browser-harness.mjs`。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check` 通过。
- `vector-transform` 在桌面前端生产构建通过：SVG 拖入与取消、文件导入、改名、G / R / S、H 解绑、左右模式同步、换选对象、输入框和输入法保护、修饰键保护、拖动期间模式保持、三种数值与鼠标变换、取消和单步撤销。
- `reference-images` 在隔离 Studio fixture 通过：批量拖入、一次撤销、图片文件选择、参考图变换与保存重开。首次冷启动遇到 Vite 依赖优化的临时 504，重跑通过。
- `property-navigation` 在 Web 生产构建通过；更新了旧测试中新增参考图按钮、SVG 菜单项的数量预期，并按名称选择导入时会重映射 ID 的零件。
- `git diff --check` 及本次涉及的 Markdown 相对文件链接检查通过。

原工作区 `pnpm format:check` 报告已有 CRLF 文件。将同一份跟踪文件复制到临时目录，仅统一为 LF 后，全库 507 个匹配文件格式检查通过；没有批量改写工作区无关文件。

## 本地证据

以下为本次运行产物，不纳入版本控制：

- `outputs/v4-qa/merge-check-2026-09-26/`：命令日志和 LF 副本格式检查。
- `outputs/v4-qa/transform-ui-reviewed-2026-09-26/`：变换回归、1440 × 1000 与 1000 × 720 截图。
- `outputs/v4-qa/merge-references-2026-09-26-final/`：参考图回归。
- `outputs/v4-qa/transform-navigation-reviewed-2026-09-26/`：Web 导航回归。

各浏览器使用独立服务与新的 context，未操作用户页面。桌面前端验证不等同于原生 Tauri 文件对话框或免安装发布验证。
