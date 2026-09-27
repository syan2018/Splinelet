# 脚本手册

这里放构建辅助、可重复的示例、自动化验证和维护工具。所有命令都从仓库根目录运行，并使用 Node.js 22.13 或更高版本。`scripts/` 是开发与验收入口，不是应用运行时模块；新增脚本应按执行环境归类，并把最小、可提交的输入放在 `scripts/tests/fixtures/`。

## 目录职责

| 路径               | 用途                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/`           | Vite 配置使用的构建辅助。`vite-public-assets.ts` 负责在桌面构建中服务和复制共享的 `public/` 资源。                                                                                                                                                       |
| `examples/`        | 可重复生成示例或演示工程的脚本；输入和输出由调用者显式指定。                                                                                                                                                                                             |
| `tests/`           | 自动化回归。`run-unit.mjs` 发现并顺序执行 `unit/` 的 hermetic 测试；`run-browser.cjs` 调度隔离的 Playwright 套件；`native/` 是实际 Tauri/WebView2 会话验收；`fixtures/` 与 `helpers/` 是测试数据和共享支撑。`legacy/` 仅保存历史基线，产品代码不得导入。 |
| `validation/`      | 示例校验、诊断、性能测量和显式离线修复。除明确写入输出的工具外，脚本只读输入。                                                                                                                                                                           |
| `agent-server.mjs` | 本地 Agent API 的 loopback 伴随服务；仅在需要该 API 的开发流程中启动。                                                                                                                                                                                   |

## 常用检查

日常改动先运行覆盖改动面的最小检查；交付前运行完整门禁：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm build
pnpm desktop:build
pnpm desktop:format:check
pnpm desktop:check
```

也可使用已定义的组合入口：

```sh
pnpm check       # typecheck、lint、Node 单测和前端格式检查
pnpm build:all   # Web 与桌面前端构建
pnpm check:all   # check、Rust 格式/编译检查和双端前端构建
pnpm test:core   # 构造链、修改器与打印分层
pnpm test:export # 通用 3MF 与 Bambu 3MF
```

`check:all` 需要 Rust 工具链和当前平台的 Tauri 系统依赖；它不包含浏览器或原生交互验收。`pnpm format` 会修改文件，检查时使用 `pnpm format:check`。

## 浏览器验收

先安装 Playwright Chromium：

```sh
pnpm exec playwright install chromium
```

浏览器 runner 只接受已登记的 `legacy` 或 `studio` case。每个 case 创建新的 Chromium 和 browser context，保存 manifest、截图与失败诊断到一个新的 `outputs/v4-qa/` 子目录；不得把它接到用户正在使用的页面、端口或已绑定的文件上。

```sh
# Web 产物上的 legacy case；先执行 pnpm build。
pnpm test:browser --suite legacy --target web --case vector-transform --port 52189 --inspector-port 52190 --output outputs/v4-qa/manual-legacy

# 桌面前端产物上的 legacy case；先执行 pnpm desktop:build。
pnpm test:browser --suite legacy --target desktop-frontend --case vector-transform --port 52189 --output outputs/v4-qa/manual-desktop

# 原 Studio 的 Vite fixture case；studio 仅支持 web fixture target。
pnpm test:browser --suite studio --case original-studio --output outputs/v4-qa/manual-studio

# 对应完整套件。
pnpm test:browser:all
pnpm test:browser:studio
```

可选参数为 `--suite legacy|studio`、`--target web|desktop-frontend`、`--case <已登记名称>`、`--port`、`--inspector-port`、`--timeout <毫秒>` 和 `--output <outputs/v4-qa/下的新目录>`。端口必须空闲，`--port` 与 `--inspector-port` 必须不同；指定的输出目录必须不存在且位于 `outputs/v4-qa/` 内。运行 `pnpm test:browser --help` 查看 runner 的当前参数。

## 原生验收

原生测试验证实际的 Tauri/WebView2 文件会话，不等同于 `desktop:build` 或 `desktop:check`。它目前只支持 Windows，要求已可用的 WebView2、`pnpm desktop:release` 生成的 `src-tauri/target/release/splinelet.exe`、公开示例资源，以及本机补充样例。补充样例的路径要求见[原生脚本](tests/native/test-v4-default-entry.mjs)；它不是可直接在干净检出中运行的通用测试。运行前关闭所有已打开的 Splinelet 进程，并确保本机 `127.0.0.1:9268` 未被占用。

```sh
pnpm desktop:release
node scripts/tests/native/test-v4-default-entry.mjs
```

测试会在 `outputs/v4-qa/` 创建自己的工程副本、WebView2 用户数据和证据，并在完成时关闭它启动的应用进程；不要把用户工程作为它的输入或输出。

## 校验与性能测量

`verify-example.mjs` 是内置示例的完整只读校验，覆盖容器往返、引用、求值、实体和两种 3MF 导出。`audit-spline-edit.mjs` 和 `audit-region-identity.mjs` 用于比较编辑后的几何与身份；`probe-tagged-noding.mjs` 和 `prototype-author-regions.mjs` 是独立的算法可行性探针，不代表产品功能或发布验收。

```sh
node scripts/validation/verify-example.mjs
node scripts/validation/verify-example.mjs --input path/to/example.spl --output-dir outputs/example-validation
node scripts/validation/audit-spline-edit.mjs --before path/to/baseline.spl --after path/to/edited.spl [--probe-unbound]
node scripts/validation/audit-region-identity.mjs --check
```

### 区域更新性能验证

性能脚本输出 JSON；它们衡量 Node 中的编辑或求值，不包含浏览器的输入到绘制延迟。把报告写到新的 `outputs/` 文件，便于和同一输入、同一 Node 版本的结果比较。

```sh
node scripts/validation/benchmark-source-interaction.mjs [path/to/project.spl]
node scripts/validation/profile-evaluation.mjs --iterations 3 --output outputs/evaluation-baseline.json
node scripts/validation/profile-evaluation.mjs --iterations 3 --baseline outputs/evaluation-baseline.json --output outputs/evaluation-after.json
node scripts/validation/profile-relief-edit.mjs --input public/sandrone-example.spl --scope both --output outputs/relief-edit.json
node scripts/validation/profile-v5-region-selectors.mjs [--input path/to/project.spl]
```

`profile-evaluation.mjs` 默认读取公开示例；`--baseline` 只比较同一示例哈希，且输出不能覆盖基线。`profile-relief-edit.mjs` 的 `--scope` 只能是 `cell`、`object` 或 `both`，并在内存会话中编辑。`profile-v5-region-selectors.mjs` 可接受 V4 输入以测量内存迁移。

浏览器端测量使用隔离 Studio 和真实 Worker；运行时避免并行构建或其他重任务。报告用于比较相同环境中的编辑延迟，不作为固定毫秒门槛。

```sh
pnpm test:browser --suite studio --case identity-performance
node scripts/tests/browser/studio/test-relief-height-edit.cjs --output outputs/v4-qa/relief-height-run
```

## 显式离线修复

这些工具只处理已知的 Sandrone 修复场景，不会在工程打开或正常求值时自动运行。先备份输入，并审阅生成的工程与报告。

```sh
# 从一个已知良好的 V4 基准和一次相邻节点删除后的 V4 副本恢复新 V5 文件。
node scripts/validation/repair-sandrone-edit.mjs --baseline path/to/good-v4.spl --edited path/to/edited-v4.spl --output outputs/repaired-v5.spl

# 仅对上一步生成的、仍带已知旧头发选择结构的 V5 副本重建显式选择。
node scripts/validation/rebuild-sandrone-selections.mjs --input outputs/repaired-v5.spl --output outputs/rebuilt-v5.spl --report outputs/rebuilt-v5-selection-report.json
```

`repair-sandrone-edit.mjs` 的三个参数都是必需的：它要求输入都为 V4，除来源中的一次相邻节点删除外其余内容与基准一致，拒绝覆盖输入或已有输出；验证失败时不会写工程，可能留下 `<output>.diagnostic.json` 供诊断。`rebuild-sandrone-selections.mjs` 只认识公开样例中固定的头发节点、算子和属性锚点；输入必须是该修复流程的中间 V5 文件，不能使用最终示例。它会写入 `--output` 和 `--report`，因此务必传入新的路径。
