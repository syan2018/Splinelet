# 工作包 3：声明式区域定义与迁移

日期：2026-09-26。状态：实验实现已保留，架构验收未通过。以下勾选仅记录 V5 实验代码存在，不代表其需求建模正确；后续以[作者模型复审](../../docs/architecture/region-identity-redesign-2026-09-26.md)为准。

- [x] V5 RegionDefinition、严格选择器语言、持久短引用及版本化解释；codec 拒绝临时句柄、旧契约和循环定义。
- [x] Path use 的逻辑区间与复合 basis pieces，由拆分、合并、反转等命令显式映射。
- [x] 带来源平面构造和完整面条件；唯一面、全部结果及缺失/歧义分开处理。
- [x] 新建、文件导入和保存使用 V5；旧格式仅在边界完整迁移，不进入 V5 求值 fallback。
- [x] 来源构造、外观、浮雕、区域 scope、复制/转移与 API 使用短定义引用；Worker 不写 Document。
- [x] V4 逐算子迁移有几何等价见证，保留属性与资产；失败不替换当前工程或覆盖源文件。
- [x] 当前内置示例可完整表示、保存和冷重开；损坏用户文件通过已知基准和明确源编辑重放修复。

新建引用必须由作者事务核对当前候选后绑定，不能把上帧或历史几何当成命名权威。旧草稿恢复也经过完整迁移。回归包含 `test-v5-region-migration.mjs`、`test-v5-region-definition-copy-transfer.mjs`、`test-v5-studio-session.mjs`，物理属性验证见[验收](../../docs/qa/region-repair-2026-09-26.md)。
