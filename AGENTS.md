# Splinelet agent guide

## 项目边界

- Splinelet 是浏览器端 2.5D 浮雕建模工具，使用 React 19、TypeScript、Vinext/Vite、Cloudflare/Wrangler、Three.js、JSTS 与 Manifold。
- `app/` 只放路由入口与全局样式。`components/` 按工作区或功能域组织界面，`hooks/` 放可复用 React 状态逻辑，`lib/` 放领域模型、几何、实体、导出与命令逻辑。
- `public/` 中的 `.mjs` 是浏览器直接加载的运行时代码，也被 Node 回归脚本导入。改动时同时检查页面、Worker 和 Node 测试。
- `scripts/` 包含测试、样例、维护和外部验证工具；fixture 必须是可进入版本控制的最小复现数据。具体分类见 `scripts/README.md`。
- `docs/` 放当前指南与架构说明；`docs/qa/` 仅存历史验收快照。产品事实以 README 和当前专题文档为准。

## 常用验证

需要 Node.js 22.13 或更高版本。先运行覆盖改动面的最小检查，交付前至少执行：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm build
```

- 使用 `pnpm test:core` 检查构造链、修改器与打印分层。
- 使用 `pnpm test:export` 检查通用 3MF 与 Bambu 3MF。
- `pnpm format` 会直接修改文件；只读检查使用 `pnpm format:check`。
- 全库 lint 与格式检查应保持通过。不要用放宽产品代码规则来掩盖问题；浏览器注入脚本和 `.cjs` 应使用适合其运行环境的独立规则。

## 高风险区域

- 保持 `app/page.tsx` 为根路由入口。拆分时优先抽取纯 helper、hook 或 props 边界清晰的面板，不要顺手改变全局状态、持久化、选择语义或 `window.traceStudio.call`。
- `public/trace-worker.js` 由绝对 URL `/trace-worker.js` 加载，并相对导入 `./geometry.mjs`。移动前必须统一更新 Worker URL、相对导入、页面调用、Node 脚本与文档。
- `/reference.png` 与 `/sandrone-example.spl` 是兼容路径。重命名时同步校验器、fetch、生成脚本和恢复测试。
- `model-worker.ts?worker` 与 `manifold.wasm?url` 使用构建器特殊加载。移动后必须执行生产构建，不能只依赖 TypeScript。
- 浏览器测试会建立 fixture、替换工程、触发保存或下载。仅在新的隔离 browser context 和非用户端口运行，绝不操作用户正在使用或已绑定文件的页面。
- 尊重已有未提交改动；不要重置、删除或格式化无关文件。

## 文档维护

- 行为、命令、公开 API、目录或导出格式变化时，同步更新 README、最贴近主题的当前文档及 `scripts/README.md`。
- 新文档使用小写 kebab-case；架构约定放 `docs/architecture/`，可重复说明放 `docs/`，历史验收放 `docs/qa/`。文件名包含已知日期，无法确认日期时使用 `-undated`，不要猜测日期。
- 一次性的本地路径、产物、数字或结论只能作为带日期的 QA 快照，不能写成当前产品承诺。
- 修改 Markdown 后检查仓库内链接和命令，避免为同一主题建立互相漂移的平行说明。

## 机械整理与迁移

- 批量重命名或移动应先形成旧路径到新路径的映射，再用脚本更新全部导入、脚本、文档链接和 pnpm 命令。
- 完成机械迁移后，用 `rg` 搜索旧路径，执行 `git diff --check`，再运行受影响的类型检查、测试和生产构建。
- 脚本按执行环境和用途成组迁移；不要只移动单个文件。迁移时统一修复仓库根路径、fixture、输出目录和共享 helper。
- 每次逻辑拆分保持单一行为边界。优先提取纯函数、类型、独立面板和共享 service，避免为降低行数复制状态或引入循环依赖。

## Subagents

- 主代理自行判断是否使用 subagents；只有当任务可明确拆分、并行带来的收益明显高于协调成本时才使用，不将并行作为默认流程。
- 使用 subagents 时默认使用 `gpt-5.6-terra` 和 `high` reasoning；只在任务确实需要时调整模型或 reasoning effort。
- 架构决策、跨模块复杂状态、几何或并发判断默认由主代理处理；必要时可将边界明确的探索、审阅、测试或机械迁移交给 subagents。
- 每个 subagent 都要明确只读或可写范围、不得触碰的文件、预期产出和必须运行的验证，避免共享工作区中的重叠修改。
