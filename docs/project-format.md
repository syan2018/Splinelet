# Splinelet 工程格式

`.spl` 是 Splinelet 的原生可编辑工程文件，MIME 为 `application/vnd.splinelet.project+zip`。它是一个自包含 ZIP 容器，不是 3MF 制造输出的别名。

## 容器结构

```text
mimetype
manifest.json
project.json
assets/reference.png | reference.jpg | reference.webp
```

- `mimetype` 存储固定 MIME 字符串。
- `manifest.json` 声明 `format`、`containerVersion`、`documentVersion`、入口和资源清单。
- `project.json` 保存曲线、构面、创作、颜色和打印分层数据，参考图字段改为资源引用。
- `assets/reference.*` 保存原参考图，避免在 JSON 中使用 base64 放大文件。

资源清单记录媒体类型、字节数和 SHA-256。读取时校验 ZIP 路径、条目数、解压上限、文件头与哈希；未来容器版本不会被旧客户端覆盖保存。

## 兼容性

- `containerVersion` 只控制 ZIP 布局，当前为 `1`。
- `documentVersion` 与 `project.json` 的工程版本一致。
- 应用仍能读取旧 `.bezier.json`；旧文件只作为导入源，下次保存创建 `.spl`。
- 3MF、STL、SVG 和 Blender Python 都是导出产物，不作为可编辑工程。

## 写入安全

桌面版先在目标目录写入临时文件，刷新后再原子替换目标文件。桌面后端只允许读写用户通过对话框或启动参数（包括手动文件关联）显式选择的路径；免安装程序不会自动注册文件关联。
