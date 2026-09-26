# 画布变换控件验收：2026-09-26

## 实现范围

在合并提交 `810b21a` 之后补齐实际画布交互。使用 `react-moveable@0.56.0` 统一处理移动、旋转和等比缩放，不再使用自写的对象指针位移／角度／半径算法。通用组件位于 `src/components/shared/transform-gizmo.tsx`，工程状态、几何命令和撤销仍由原有会话处理。

选中对象显示移动选框、四角缩放柄、顶部旋转柄和中心标记。G / R / S 与侧栏模式一致，H 无绑定。对象本身和选框始终执行移动；缩放默认固定对角，Alt 开始拖拽时改为中心缩放；Shift 提供轴约束、15° 或 10% 步进。

控件代理、源线、面和派生曲线同步预览；画布显示实时毫米位移、角度、百分比与尺寸。数值面板使用同一选框中心。单根对象使用世界姿态定向框，多个独立根使用世界轴对齐框；手柄尺寸不随画布缩放。缩放保留浮雕厚度与制造层高。

预览不修改规范文档，期间拒绝 API 写入和导出；松手一次提交，Esc、失焦、指针取消或丢失捕获还原。等待求值时保留已提交的变换位置并暂停新手势。Shift / Ctrl / Meta 多选、右键平移、画布外松手继续工作。

## 验证

- `pnpm typecheck`、`pnpm lint`：通过。
- `pnpm test`：141 个单元测试通过，包括新增的定向框、嵌套旋转、隐藏节点、源线回退和缩放基点测试。
- `pnpm build`、`pnpm desktop:build`：通过。
- `pnpm desktop:format:check`、`pnpm desktop:check`：通过。
- `vector-transform`：Web 和桌面前端生产构建通过。通过真实鼠标拖动三种 Moveable 控件，比较源线与选框的预览矩阵、松手后的轮廓和选框、单次撤销和取消；验证旋转之后再缩放、相机平移缩放、Alt 中心缩放、Shift 步进、G / R / S 与输入保护、预览期间 API 写入与导出拒绝。
- `object-move`：桌面前端生产构建通过。整组／多选、首次只选择、三种多选修饰键穿透选框、微小抖动、取消生命周期、画布外释放和右键平移通过。
- `object-move-pipeline`：Web 生产构建通过。真实 Sandrone 派生轮廓拖动时不发布文档，松手只提交一次，源定义和未选对象保持不变，一步撤销。
- `git diff --check` 通过；本地没有 MERGE_HEAD、未合并索引项或冲突标记。此前合并见[合并验收](merge-transform-ui-2026-09-26.md)。

原工作区 `pnpm format:check` 报告 365 个既有文件的 CRLF 换行差异。同一份工作文件复制到临时目录、仅统一 LF 后，全库格式检查通过；未批量重写无关文件。

## 本地证据

以下运行产物不纳入版本控制：

- `outputs/v4-qa/gizmo-desktop-final-2026-09-26/`：最终桌面前端三种控件回归、拖动预览、1440 × 1000 与 1000 × 720 界面截图。
- `outputs/v4-qa/gizmo-web-final-2026-09-26/`：Web 三种控件回归。
- `outputs/v4-qa/gizmo-move-final-2026-09-26/`：多选与移动生命周期回归。
- `outputs/v4-qa/gizmo-pipeline-verified-2026-09-26/`：派生轮廓与文档隔离回归。
- `outputs/v4-qa/gizmo-unit.log`、`gizmo-web-build.log`、`gizmo-desktop-build.log`、`gizmo-rust.log`、`gizmo-format.log`：命令日志。

所有浏览器运行使用独立端口和新 context，没有操作用户正在使用或绑定文件的页面。桌面前端验证不等同于原生文件对话框或免安装发布验证。
