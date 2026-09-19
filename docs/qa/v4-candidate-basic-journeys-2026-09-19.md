# V4 候选基本旅程验收快照 · 2026-09-19

范围：`codex/editor-model-v4-plan` 的 V4 候选入口。默认页面保持原编辑器。本快照只记录已执行证据，不签收完整重构或默认切换。

## 已执行

- `pnpm check:all`：53 个 Node 单元测试、TypeScript、全库 lint/格式、Rust format/check、Web 与桌面前端构建通过。
- `pnpm test:browser --suite v4 --target desktop-frontend --port 4187 --inspector-port 9247`：4/4 通过，证据 `outputs/v4-qa/2026-09-19T12-52-02-879Z-59112-54f31c38/manifest.json`。
- `pnpm test:browser --suite v4 --target web --port 4188 --inspector-port 9248`：4/4 通过，证据 `outputs/v4-qa/2026-09-19T12-54-50-859Z-55280-20298c72/manifest.json`。包含可见成品预览布局的最终复验。
- 两端都由 runner 建立独立服务、浏览器和 context，不连接用户页面。manifest 记录实际构建摘要、测试源摘要与案例结果。

四项实际旅程：

1. 画闭合线条形成一个部件，点候选上色、改厚度，经真实 Worker/Manifold 导出 STL，撤销保留区域。
2. 拖动通过 preview 更新 pose，提交一次，撤销一次恢复世界几何，部件身份保留。
3. 同部件画闭合孔，撤销恢复原区域；开放切割线分成两块，颜色和启用浮雕贡献随来源迁移，不增加部件。
4. 下载 V4 工程，等待应用完成独立 IndexedDB 草稿写入；刷新后恢复，重新打开已保存字节，Document 精确相等。

成品预览使用当前 BodySet 的材料网格、真实 Three.js/WebGL 渲染；已检查桌面前端 `basic-authoring/body-preview.png`，并增加预览位于可见工作区内的边界断言。

## 本轮修正与限制

浏览器检查发现并修正默认色板缺失、异步求值前过早断言、测试抢先建立空恢复数据库、预览网格超出可见工作区。恢复测试改为等待应用的事务完成状态，保持真实保存/刷新/重开断言。

完整用户旅程 U01–U06/A01–A23 未全部签收。尚需完整曲线/节点/派生柄交互、重复与引用/制造属性任务、复制/源转移命令、导出各格式和旧工程等价性、原生桌面文件事件及旧 API 适配。旧产品浏览器基线的 5 个失败仍见[前一快照](v4-foundation-baseline-2026-09-19.md)，不能被候选的四项 PASS 抹去。G4/G5 未通过，默认入口不切换。

默认入口附加回归：pnpm test:browser --suite legacy --target desktop-frontend --case object-move --port 4187 --inspector-port 9247 通过；证据 outputs/v4-qa/2026-09-19T12-55-22-124Z-52780-fc64b3ef/manifest.json。它只确认新入口分派未破坏该既有旅程，不替代旧基线未通过项。
