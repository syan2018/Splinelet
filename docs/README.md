# Splinelet 文档索引

这里按用途区分当前说明、架构约定与历史验收记录。产品现状以用户指南和专题说明为准；`qa/` 中的数字、文件路径与结论只代表对应日期的测试快照。

## 入门与工作流

- [项目首页与完整工作流](../README.md)
- [统一创作与 Agent API](../CREATION.md)
- [源线编辑器与兼容 API](source-editor.md)
- [高级构面与实体操作](../MODELING.md)

## 专题说明

- [面修改器](modifiers.md)
- [构造链与失效处理](architecture/construction-pipeline.md)
- [打印分层](print-stack.md)
- [3MF 打印导出](3mf-export.md)

## 历史 QA 快照

- [统一创作验收（2026-09-12）](qa/creation-acceptance-2026-09-12.md)
- [Crown closure repair（2026-09-12）](qa/crown-closures-2026-09-12.md)
- [Object holes and named regions（2026-09-12）](qa/frame-hole-2026-09-12.md)
- [Hair partition repair（2026-09-12）](qa/hair-partition-2026-09-12.md)
- [修改器 QA（2026-09-12）](qa/modifiers-2026-09-12.md)
- [路径跨集合移动回归（日期未记录）](qa/path-transfer-undated.md)
- [Region selection and crown repair（2026-09-12）](qa/region-repair-2026-09-12.md)
- [Selection and local region editing（2026-09-12）](qa/selection-scope-2026-09-12.md)
- [Endpoint continuation and spline inspectors（2026-09-12）](qa/spline-endpoints-2026-09-12.md)

历史记录中引用的 `outputs/`、`backups/` 或工作区外路径通常是未纳入仓库的本地证据。可重复回归应以 `scripts/tests/fixtures/` 和当前测试脚本为准。
