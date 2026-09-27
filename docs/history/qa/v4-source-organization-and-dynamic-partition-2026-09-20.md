# 源顺序与动态分区接边验证

日期：2026-09-20。范围：原工作区接入所需的来源组织和迁移求值；不作为 V4 GUI 或原生文件操作签收。

## 本次发现与修复

原 V4 投影按 ID 排列来源，不能保持旧列表顺序。新增 `Path.order` 和 `Collection.order`，迁移写入旧顺序，保存重开后保持；源画布与作品树读取同一排序。缺省次序使用固定字符串比较，不依赖宿主语言。集合投影保留逐成员引用和缺失状态，不把重叠成员强行压成单一 `groupId`；整理命令不改几何、所有权、构造输入或高度。

核对实际工程时发现迁移分区接边仍生成隐藏 Path，复用了原 Edge，并保存首次求得的延伸端点。这会阻止原边的自由编辑，也不能保证边界移动后的接边正确。此前原曲线等价比较只覆盖映射到旧路径的部分，未证明全部可写来源都来自原工程。

`test-v4-import-source-identity.mjs` 现在严格检查全部原始 Path/Edge、边使用次数、孤立 Vertex 与原列表顺序。内置 Sandrone 为 76 条路径、569 段原始曲线；补充 gold 为 79 条、575 段。本次本地执行两者均通过，不再生成可写分区接边辅助源。原件只读。

分区接边改为明确的 `endpointJoin` 求值策略。真实 hair 分区的端点和底面分别修改后仍正常求值，轮廓身份和浮雕绑定保持对应；复制后继续编辑同样通过。复制重映射会重新规范化来源 token 顺序、轮廓循环起点、孔次序及 lineage，并同时更新输出契约和引用它的属性/作用范围。无禁用选项、选定区域作用范围和区域引用底面均有专项回归；不以重新接受任意新契约绕过身份校验。

原节点、底层 add-path 和复制部件中的新增 Path 都使用统一尾部顺序分配；复制跨多个 Sketch 时保留原相对次序。无法继续增长的极大 order 原子拒绝。排序与复制测试同时验证一次撤销。

## 命令与验收边界

```sh
node scripts/tests/unit/test-v4-source-order.mjs
node scripts/tests/unit/test-v4-source-organization.mjs
node scripts/tests/unit/test-v4-source-order-creation.mjs
node scripts/tests/unit/test-v4-partition-endpoint-join.mjs
node scripts/tests/unit/test-v4-legacy-partition-dynamic.mjs
node scripts/tests/unit/test-v4-partition-identity.mjs
node scripts/tests/unit/test-v4-import-source-identity.mjs
node scripts/tests/unit/test-v4-import-source-identity.mjs F:/Projects/Splinelet/output/agent-emblem/sandrone-gold-emblem.spl
```

`pnpm check:all` 退出码 0：87 项 hermetic 单元测试、类型、lint、格式、Rust 格式与编译、Web 和桌面前端构建全部通过。日志：`outputs/v4-qa/check-all-source-order-dynamic-partition-2026-09-20.log`。两份工程的既有等价比较仍通过，内置区域 69→69、gold 70→70，最大面积差仍为 `0.000120307128152705 mm²`；原件 SHA256 与此前记录一致。

补充工程路径是本地验收范围，不是 CI 必备输入。全部可写源一致与排序测试通过，不等于原画布回调、文件会话及实际保存重开已接入；默认入口仍为原 UI 的旧后端。原工作区和原生保存旅程仍未签收，goal 继续进行。
