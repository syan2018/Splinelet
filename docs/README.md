# Splinelet 文档

这里的指南和架构说明持续维护，描述当前行为；文件名按主题固定，不按日期创建副本。

| 内容                     | 位置                 | 维护方式                                   |
| ------------------------ | -------------------- | ------------------------------------------ |
| 产品介绍与启动入口       | 根目录 `README.md`   | 保持简短，与当前功能一致                   |
| 使用、格式与 API         | `docs/`              | 在同一专题中更新操作、契约和限制           |
| 架构与设计约束           | `docs/architecture/` | 更新现行边界，保留仍适用的设计理由         |
| 可重复运行的开发工具     | `scripts/README.md`  | 维护命令、前提和参数，不堆积运行结果       |
| 任务计划与进度           | `tasks/`             | 跟踪工作包；交付后将长期知识整理进当前文档 |
| 历史方案、实验与验收日志 | `docs/history/`      | 保留当时的范围和结论，不作为当前产品承诺   |

## 使用指南

- [项目首页](../README.md)：功能、运行方式与适用范围。
- [上手指南](getting-started.md)：从参考图描线到保存、打印导出的完整工作流。
- [参考图](reference-images.md)：图层、变换与保存。
- [源线编辑器](source-editor.md)：节点、路径、快捷键和兼容 API。
- [面修改器](modifiers.md)：分区、布尔、偏移与构造链编辑。
- [打印分层](print-stack.md)：堆叠位置、打印层高与厚度。
- [高级构面与实体操作](modeling.md)。

## 格式与自动化

- [Splinelet `.spl` 工程格式](project-format.md)。
- [3MF 打印导出](3mf-export.md)：通用 3MF 与 Bambu 工程。
- [统一创作 API](creation.md)：创作命令与示例。
- [Agent API](agent-api.md)：身份、修订、二进制传输与兼容写入。

## 开发与架构

- [脚本与验证](../scripts/README.md)：检查命令、浏览器隔离与测量工具。
- [工程结构](architecture/project-structure.md)：目录职责与平台边界。
- [交互约定](interaction-design.md)：工具、选择与属性面板行为。
- [构造链与失效处理](architecture/construction-pipeline.md)。
- [修改器链与断链修复](architecture/modifier-chain-recovery.md)。
- [编辑交互管线](architecture/editor-interaction-pipeline.md)。
- [选区属性贡献](architecture/property-contributions.md)。
- [参考图架构](architecture/reference-images.md)。

## 历史设计与工程记录

以下内容用于追溯设计和实施，不作为当前功能说明：

- [历史记录索引](history/README.md)：旧设计、实验和验收快照。
- [工程任务](../tasks/README.md)：工作包、依赖和交付记录。

历史记录中的 `outputs/`、`backups/` 和工作区外路径可能是未提交的本地证据。可重复验证使用当前脚本和 `scripts/tests/fixtures/`。
