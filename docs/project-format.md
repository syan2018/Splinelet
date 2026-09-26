# Splinelet 工程格式

V5 保存明确的作者选择与修改器输入；其边界见[修改器链设计](architecture/region-identity-redesign-2026-09-26.md)。

`.spl` 是 Splinelet 的原生可编辑工程文件，MIME 为 `application/vnd.splinelet.project+zip`。它是一个自包含 ZIP 容器，不是 3MF 制造输出的别名。

## 容器结构

```text
mimetype
manifest.json
project.json
assets/reference.png | reference.jpg | reference.webp
assets/<asset-id>.png | <asset-id>.jpg | <asset-id>.webp
```

- `mimetype` 存储固定 MIME 字符串。
- `manifest.json` 声明 `format`、`containerVersion`、`documentVersion`、入口和资源清单。
- `project.json` 保存曲线、构面、创作、颜色和打印分层数据，参考图字段改为资源引用。
- `assets/reference.*` 保留基准图兼容路径，附加图使用 `assets/<asset-id>.*`；`assets` 保存资源描述，`references` 保存图层和仿射变换，多个图层可以共享同一资源。图片字节不进入 Document 或撤销历史。
- Reference 的可选 `role`（`base` / `overlay`）与 `order` 描述基准身份和从下至上的绘制顺序。缺少这些字段的旧 V4 文档按校准矩阵识别基准图；V1–V3 仍通过旧工程导入器转换。源坐标和毫米比例继续由 `sourceFrame` 决定。
- 当前容器与文档版本为 1 / 5。V5 保存 `evaluationSemanticsVersion: 1`、路径逻辑参数基准和 `regionDefinitions`；不保存临时 `cell:` 句柄、旧 `outputContract` 或 Worker 缓存。用户明确创建的 `region-snapshot-source` 将选定成功快照的局部几何保存为算子参数，是独立作者输入；正常求值不写回几何。严格校验拒绝未知字段与不一致引用，旧客户端不能忽略后覆盖。
- 删除最后一个图片引用时，当前文档删除对应资源描述；会话保留撤销所需字节直到关闭工程，保存与草稿只写当前文档引用的资源。

资源清单记录媒体类型、字节数和 SHA-256。读取时校验 ZIP 路径、条目数、解压上限、文件头与哈希；未来容器版本不会被旧客户端覆盖保存。

## 兼容性

- `containerVersion` 只控制 ZIP 布局，当前为 `1`。
- `documentVersion` 与 `project.json` 的工程版本一致。
- 原生 V5 直接打开。V4 在打开边界完整迁移并核对逐算子区域几何，成功后作为未绑定原文件的待保存 V5 工程；失败时不替换当前工程，也不自动覆盖来源文件。旧草稿恢复遵循同一迁移边界。
- 应用仍能读取旧 `.bezier.json`；旧文件只作为导入源，下次保存创建 `.spl`。
- 3MF、STL、SVG 和 Blender Python 都是导出产物，不作为可编辑工程。

## 写入安全

保存只编码当前作者 Document，不等待区域或实体求值。区域定义暂时缺失或存在歧义不会阻止保存，但制造导出需要完整、有效的求值结果。区域定义及路径基准的语义见[构造链](architecture/construction-pipeline.md)和[区域定义决策](architecture/region-identity-redesign-2026-09-26.md)。

桌面版先在目标目录写入临时文件，刷新后再原子替换目标文件。桌面后端只允许读写用户通过对话框或启动参数（包括手动文件关联）显式选择的路径；免安装程序不会自动注册文件关联。
