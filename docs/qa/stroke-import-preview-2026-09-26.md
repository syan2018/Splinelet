# SVG 笔画宽度与曲线预览验收：2026-09-26

本次修复将已有 Stroke 的 `widthMM` 接入修改器参数投影、原界面输入和 V4 编辑命令。曲线预览与修改器卡片不再将正常开放路径的信息记录显示为警告，重复诊断合并；画布说明和阶段选择默认收起。

## 已通过

- `pnpm typecheck`、`pnpm lint`、`pnpm test`（142 个单元测试模块）。
- `pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check`。
- 本次修改文件的 `oxfmt --check` 与 `git diff --check`。
- 新增 `test-v4-stroke-modifiers.mjs` 验证导入后的实际几何宽度、上游阵列实例、稳定输出身份、源线与厚度保留、撤销重做、`.spl` 保存重开、参数绑定和父组锁定。
- `pnpm test:browser --suite legacy --case vector-transform --target desktop-frontend --port 52194 --inspector-port 9248`：全新隔离 browser context 与独立服务；真实 SVG 导入后，通过原界面调整笔画宽度，验证轮廓变化及单步撤销重做，原有对象变换旅程也通过。
- 原组件 smoke 的修改器和预览阶段通过，验证说明默认收起、开放路径信息不外露、展开后可切换阶段和关闭预览。

浏览器证据位于本机 `outputs/v4-qa/2026-09-26T07-47-37-336Z-50416-55fd299e/`，包含 manifest 和 `vector-transform/stroke-width.png`。这些路径与数量仅属于本次验收；桌面静态前端测试不等于 Tauri 原生文件会话验收。

## 已有门禁问题

- `pnpm check:all` 在全量单元测试通过后，由 `pnpm format:check` 报告 351 个现有文件格式问题而中断。例如未修改的 `src/lib/editor/selection.mjs` 使用 CRLF，单独检查同样失败。本次未批量格式化无关文件，其后的原生检查与双端构建已分别执行并通过。
- `node scripts/tests/browser/smoke/test-v4-original-modifier-controls.cjs` 的后续参考图拖动夹具调用已不匹配当前 `useSourceDrag`：缺少 `onActiveChange`，且仍调用已经移除的 `onObjectPointerDown`。补回回调后确认第二处旧接口问题；本次未保留这些无关夹具的临时修改，整套旧 smoke 不能记为通过。
