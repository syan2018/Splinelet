# 原工作区恢复与请求层整理 · 2026-09-19

范围：`codex/editor-model-v4-plan`，入口恢复提交 `eb7e07b` 之后的共享 Worker 请求层改动。此次验证原工作区行为保持，不签收 V4 数据模型接入。

## 改动

- Web 与桌面入口均加载原 `studio-app.tsx`；`?editor=v4` 不再替换界面。
- 平面创作与建模面板共用 `evaluation/worker-client.mjs` 管理请求配对与关闭。引擎失效后拒绝后续请求，避免继续等待已失效的 Worker；发送失败释放对应请求。正常面板 DOM/CSS 与业务求值保持。
- 请求层不拥有工程、选择或 revision；求值结果是否仍有效仍由工作区判断。

## 实测

```sh
node scripts/tests/unit/test-worker-client.mjs
node scripts/tests/browser/smoke/test-sandrone-restored-ui.cjs --target web --port 4192 --inspector-port 9252 --output outputs/v4-qa/sandrone-restored-ui-web-pass-2026-09-19
node scripts/tests/browser/smoke/test-sandrone-restored-ui.cjs --target desktop-frontend --port 4193 --output outputs/v4-qa/sandrone-restored-ui-desktop-final-2026-09-19
```

上述检查通过。两个前端都验证了内置 Sandrone 的 76 条路径、11 个对象、69 个区域，实际选线和选区域，修改厚度后一次撤销恢复完整工程。gold 工程为 79 条路径、12 个对象、70 个区域；选取来源和生成区域后切回对象，镜像、四向阵列、闭合构面三张构造卡名称全部匹配。两个工程均检查底图、原工具布局及立体画布，并保存截图；浏览器 console error 与 page error 均为空。

证据：Web 与 desktop-frontend 的上述输出目录各包含 `manifest.json` 及四张截图。脚本只在自身服务器及新浏览器 context 内运行；测试结束清理服务器。

`pnpm typecheck`、`pnpm lint`、`pnpm build:all`、`pnpm desktop:release`、`pnpm desktop:check`、`pnpm desktop:format:check` 通过。共享请求层单测涵盖乱序响应、未知响应、单次求值失败、发送失败、关闭、致命错误及错误后的新请求。

全库 `pnpm test` 此时在并行实施中的 V4 importer `test-v4-migration.mjs` 因 `surface-output-missing` 失败；`format:check` 尚有 importer 及其等价测试两处未格式化。不能据此声明全库验收完成。本次浏览器回归也不等于原生打开/保存对话框或 V4 迁移等价验收。

## 后续运行时边界复验

CreationWorkspace 增加可选运行时接口后，`pnpm typecheck`、`pnpm lint`、`pnpm build:all` 和 `node scripts/tests/unit/test-v4-creation-runtime.mjs` 通过。默认入口未注入 V4，双端原 UI smoke 再次通过，证据分别位于 `outputs/v4-qa/creation-runtime-web-2026-09-19` 和 `outputs/v4-qa/creation-runtime-desktop-2026-09-19`。这次结果覆盖原布局、两个 Sandrone 工程及内置工程厚度编辑/撤销；不代表 V4 已接管原界面。

运行时单测另外覆盖同一 V4 会话中的上色、预备厚度事务、一次撤销、模板更新、外部展示句柄拒绝、异步过期结果拒绝，以及同一手势 ID 内预览变化。实体/导出求值、底板及源路径适配仍未完成。

## 原件只读核对结果

| 文件                                                                         | 运行后 SHA256（与运行前相同）                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `public/sandrone-example.spl`                                                | `0997DD9A6D41AE21DEF3E1555C0BE4286668A29F4273FA4E9758C188CC883A86` |
| `output/agent-emblem/sandrone-gold-emblem.spl`（本地补充样例，不纳入版本库） | `DB86281E03037A187E27D8F15AE8E13EB0F4E7B8CF6887CAC120BD149815BB4E` |
