# 顶栏与参考图入口验收：2026-09-26

## 改动

顶栏左侧集中展示 Splinelet 文件菜单、工程名称与保存状态，右侧使用紧凑的中性保存／导出按钮。导出仍打开“检查与导出”面板。窄屏隐藏保存文字并保留图标，工程名称自动截断。

参考图入口移至画布“显示选项 → 管理参考图”，打开时收起显示菜单并将焦点移入面板；面板新增关闭按钮，关闭时结束参考图调整并将焦点返回显示选项。拖入图片仍自动打开面板。

参考图保存重开回归发现变换选框读取了上一个运行时的展示工程。求值缓存现携带所属运行时，文件切换后等待新运行时求值，避免跨工程读取过期对象。

## 验证

- `pnpm typecheck`、`pnpm lint`：通过。
- `pnpm test`：141 个单元测试通过。
- `pnpm build`、`pnpm desktop:build`：通过。
- `pnpm desktop:format:check`、`pnpm desktop:check`：通过。
- `property-navigation`：Web 与桌面前端生产构建通过；检查参考图入口、面板关闭与焦点、导出面板、文件菜单和工程状态不变。
- `reference-images`：通过；导入、拖动、缩放、旋转、取消、锁定、透明度、保存与重开保持正常。截取 1440 × 900、1000 × 720、540 × 720 布局与参考图入口／面板并检查。
- `vector-transform`：桌面前端生产构建通过；验证三种控件的拖动、同步预览、提交、撤销、取消和快捷键。

参考图测试首次暴露上述运行时缓存问题；修复后一次运行遇到 Vite 开发依赖优化的 `504 Outdated Optimize Dep`，重新建立隔离 context 后完整回归通过。

原工作区 `pnpm format:check` 报告 362 个既有文件的 CRLF 差异。没有批量重写无关文件；使用临时副本仅统一 LF 后核验全库格式。所有浏览器运行使用独立端口与新 context，未操作用户正在使用或已绑定文件的页面。桌面前端测试不等同于原生窗口或原生文件对话框验收。

## 本地证据

以下产物不纳入版本控制：

- `outputs/v4-qa/header-navigation-2026-09-26/`：Web 顶栏导航。
- `outputs/v4-qa/header-navigation-desktop-2026-09-26/`：桌面前端顶栏导航。
- `outputs/v4-qa/header-references-verified-2026-09-26/`：参考图完整回归与布局截图。
- `outputs/v4-qa/header-transform-desktop-2026-09-26/`：三种变换控件回归。
- `outputs/v4-qa/header-*.log`：单元测试、类型、lint、双端构建、Rust 与格式检查日志。
