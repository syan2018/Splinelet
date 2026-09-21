# SVG 笔迹与对象变换验收：2026-09-22

## 测试与产物

Windows，独立 Vite 端口和新建 Chromium context，1600 × 1100；未操作用户页面，也未覆盖原工程。

- 本地输入：`output/agent-emblem/sandrone-gold-emblem-v4.spl`。
- 输出：`output/agent-emblem/sandrone-gold-emblem-signature-v4.spl`。
- 预览：`output/agent-emblem/sandrone-gold-emblem-signature-v4-preview.png`。
- 已提交 SVG：[手写签名](../../scripts/tests/fixtures/sandrone-signature.svg)。字样为手工设计的 Sandrone，并非官方签名字样。

签名宽度 23 mm，中心 `[8, -29.5]` mm，厚度 0.6 mm，贴附「杯子」。新场景组含正文与下划线两个笔画部件；保留原有部件、构造及参考资源。

```sh
node scripts/examples/add-sandrone-signature.mjs output/agent-emblem/sandrone-gold-emblem-v4.spl output/agent-emblem/sandrone-gold-emblem-signature-v4.spl
```

脚本自行启动隔离服务和浏览器，输出路径必须不同于输入。上述私有输入不是测试门禁依赖。

## 回归范围

`test-vector-transform.cjs` 使用已提交公开样例和签名 SVG：实际文件选择、尺寸和贴附、导入一步撤销／重做；双击改名后逐字输入和中间插字、Esc 取消、Enter 提交；组数值旋转／缩放；三种鼠标拖动的无文档预览、Esc 回退、松手一次提交和完整撤销。

```sh
pnpm desktop:build
pnpm test:browser --suite legacy --case vector-transform --target desktop-frontend --port 52189 --timeout 120000
```

解析单测覆盖曲线精度、圆弧近似、填充孔洞与描边分组；命令单测覆盖毫米转换、控制柄、颜色、贴附与无效输入原子失败。对象变换单测覆盖旋转父级、组内源几何与算子空间参数、世界坐标输入、约束、锁定、撤销与编码往返。

浏览器测试验证共享桌面前端，不等于 Tauri 原生文件对话框验收。SVG 不支持的外观会明确拒绝；缩放不改变厚度，跨选区空间依赖须一起选择。当前能力与使用方法见 [源编辑器指南](../source-editor.md)。
