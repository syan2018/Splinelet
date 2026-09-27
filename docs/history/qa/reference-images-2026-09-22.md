# 多参考图验收快照

日期：2026-09-22。范围为当前工作树的原 Studio、V4 会话和 Web／桌面共享前端；没有执行 Tauri 原生窗口和系统文件对话框验收。

## 结果

- `pnpm typecheck`、`pnpm lint` 通过。
- `pnpm test`：137 个 hermetic 单元测试通过。最终资源缓存上限改动另复跑 reference-host、reference-commands、reference-evaluation 和 v4-studio-host，均通过。
- `pnpm build`、`pnpm desktop:build` 通过。
- `pnpm desktop:format:check` 通过；`pnpm desktop:check` 首次被本机 sccache 端口拒绝阻断，当前进程清空 `RUSTC_WRAPPER` 后通过，未更改项目 Rust 配置。
- `git diff --check` 与本次修改文件的 `oxfmt --check` 通过。
- 全库 `pnpm format:check` 未通过：当前 Windows checkout 的 `core.autocrlf=true` 使未修改文件为 CRLF，格式器要求 LF。未批量格式化无关文件或放宽项目规则。旧文本 fixture 哈希测试现统一以 LF 计算，已核对所有相关 manifest 哈希与原内容一致。

## 浏览器证据

命令：`pnpm test:browser --suite studio --case reference-images --port 4187 --inspector-port 9247 --output outputs/v4-qa/reference-images-final-2-fixed`，通过。每次运行使用独立服务、全新 browser/context 和临时文件存储。

本地证据位于 `outputs/v4-qa/reference-images-final-2-fixed/manifest.json` 与对应截图，不纳入版本控制。覆盖多文件导入、保持基准图／曲线／对象、平移／缩放／旋转、一次手势一次撤销、重做、透明度、排序、锁定、保存重开、Esc／失焦取消、调整期间 Delete 保护以及完成后返回节点／选择工具。检查无页面与 console 错误。

交互测试曾发现面板被底部色卡遮挡、Esc 取消手势与主工作区键盘处理冲突，均修复并实际复测。缓存审阅还发现反复导入／删除可能累积图片资源，已增加会话级字节、像素与资源数量上限，并验证超限不新增 URL 或修改历史、之前的删除仍可撤销。

另在 `http://127.0.0.1:4387/` 对真实桌面前端开发入口进行隔离加载检查，原 Studio 与参考图面板正常。这是本次试用地址，不是固定产品端口。
