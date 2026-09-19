# 工程结构与平台边界

Splinelet 使用单一前端工程，共享 React 应用、领域模型和 Worker，通过 Web 与 Tauri 两个入口启动。

## 目录职责

| 路径                                                          | 职责                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `app/`                                                        | Web 路由、页面元数据和两端共用的全局样式                              |
| `src/desktop/`                                                | 桌面 HTML 与 React 启动入口                                           |
| `src/components/studio/`                                      | 共享应用主体、工作区组合与应用状态                                    |
| `src/components/shell/`                                       | 窗口控制等宿主界面                                                    |
| `src/components/{creation,modeling,source-editor,shared,ui}/` | 各工作区与通用界面                                                    |
| `src/hooks/`                                                  | 可复用 React 状态逻辑                                                 |
| `src/lib/platform/`                                           | Tauri 桥接、浏览器下载及平台分派                                      |
| `src/lib/source-editor/`                                      | 选择、节点编辑、连续性、连接与画布数学                                |
| `src/lib/persistence/`                                        | IndexedDB 恢复草稿与文件写入队列                                      |
| `src/lib/` 其他模块                                           | 领域模型、几何构造、实体、导出和模型 Worker                           |
| `src/types/`                                                  | Vite 资源与 Worker 导入的环境类型声明                                 |
| `public/`                                                     | 示例资源、图标与兼容描线运行时                                        |
| `src-tauri/src/`                                              | Rust 应用装配、IPC 命令、文件权限和外部打开事件                       |
| `src-tauri/target/frontend/`                                  | 桌面前端构建输出                                                      |
| `scripts/build/`                                              | 构建辅助模块                                                          |
| `scripts/tests/`                                              | Node 回归、隔离浏览器回归及最小 fixture                               |
| `docs/`                                                       | 当前使用、架构、专题说明；`qa/` 仅为历史验收                          |
| `tasks/`                                                      | 复杂任务总控、模块分发与逐项验收；见[任务目录](../../tasks/README.md) |
| `dist/`                                                       | Web 构建输出                                                          |

根目录的主要目录是 `app/`、`src/`、`public/`、`src-tauri/`、`scripts/`、`docs/` 和 `tasks/`。`dist/` 仅存 Web 构建生成物，不纳入版本控制；桌面前端产物归入 `src-tauri/target/frontend/`，避免 Web 构建清理 `dist/` 时波及桌面产物。

## 依赖与状态边界

`app/page.tsx` 与 `src/desktop/main.tsx` 都引用 `src/components/studio/studio-entry.tsx`；默认加载 `studio-app.tsx`，`?editor=v4` 加载隔离候选 `studio/v4/v4-studio-app.tsx`。客户端边界放在共享组件上，Web 路由不承担应用实现，桌面入口不导入 Web 路由组件。`@/*` 映射到 `src/*`。

`src/lib/platform/index.mjs` 提供跨平台下载分派，并导出桌面能力；`desktop.mjs` 封装 Tauri API，`browser.mjs` 负责浏览器下载。工程绑定、打开、保存与恢复的编排仍留在共享应用中。继续提取时应按行为边界拆分，不复制两套保存状态，不改变 `window.traceStudio.call`。

Rust 的 `lib.rs` 装配应用，`commands.rs` 定义 IPC，`files.rs` 管理路径授权与原子文件操作，`open_files.rs` 处理命令行和单实例文件打开。拆分不改变命令名、授权规则和事件协议。

## 构建与兼容资源

`vite.config.ts` 负责 Vinext / Cloudflare Web 构建；`vite.desktop.config.ts` 负责桌面客户端构建。两个构建共享应用源码，分别输出 `dist/` 与 `src-tauri/target/frontend/`，生成目录不纳入版本控制。桌面输出归入 Tauri 的 target，避免 Web 构建清理 `dist/` 时波及它。

桌面交付采用免安装原生程序。`pnpm desktop:release` 使用 `tauri build --no-bundle` 将前端嵌入可执行文件，Windows 产物为 `src-tauri/target/release/splinelet.exe`。Tauri 配置中 `bundle.active` 为 `false`，仅保留应用图标配置；不生成 MSI / NSIS、不安装 WebView2、不自动注册文件关联。目标电脑需自行具备 WebView2 Runtime。用户可手动关联 `.spl`，命令行打开和单实例转交仍由 `open_files.rs` 处理。

`public/trace-worker.js` 继续通过 `/trace-worker.js` 加载，并相对导入 `geometry.mjs`。该几何模块同时供应用和 Node 测试使用，所以桌面构建仍通过 `scripts/build/vite-public-assets.ts` 提供静态资源服务与复制。这里保留一份几何实现，不能直接删除插件或启用普通 `publicDir` 而不验证模块导入。

`/reference.png`、`/sandrone-example.spl`、`/trace-worker.js` 和 `/geometry.mjs` 保持现有路径。模型 Worker 的 `?worker` 与 Manifold 的 `?url` 导入需要双端生产构建验证。

## 迁移映射（2026-09-19）

| 原路径                                                                       | 当前路径                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 根目录 `desktop/`                                                            | `src/desktop/`                                                |
| 根目录 `components/`                                                         | `src/components/`                                             |
| 根目录 `hooks/`                                                              | `src/hooks/`                                                  |
| 根目录 `lib/`                                                                | `src/lib/`                                                    |
| 根目录 `types/`                                                              | `src/types/`                                                  |
| `dist-desktop/`                                                              | `src-tauri/target/frontend/`                                  |
| `app/page.tsx` 中的应用主体                                                  | `src/components/studio/studio-app.tsx`；原路径保留薄路由      |
| `components/desktop-window-controls.tsx`                                     | `src/components/shell/desktop-window-controls.tsx`            |
| `lib/desktop-runtime.mjs`                                                    | `src/lib/platform/{index,desktop,browser}.mjs`                |
| `public/{canvas-gestures,connect,continuity,extend,node-edit,selection}.mjs` | `src/lib/source-editor/` 下同名文件                           |
| `public/persistence.mjs`                                                     | `src/lib/persistence/workspace.mjs`                           |
| `public/creation-pick.mjs`                                                   | `src/lib/creation-pick.mjs`                                   |
| `components/creation/model-worker.d.ts`                                      | `src/types/worker.d.ts`                                       |
| `lib/vite-assets.d.ts`                                                       | `src/types/vite-assets.d.ts`                                  |
| `vite.desktop.config.ts` 中的静态资源插件                                    | `scripts/build/vite-public-assets.ts`                         |
| `src-tauri/src/lib.rs`                                                       | 同目录的 `lib.rs`、`commands.rs`、`files.rs`、`open_files.rs` |
| 根目录 `CREATION.md`                                                         | [统一创作](../creation-2026-09-19.md)                         |
| 根目录 `MODELING.md`                                                         | [高级构面](../modeling-2026-09-19.md)                         |

## 验证入口

从仓库根目录运行 `pnpm check:all`：依次执行类型检查、lint、Node 单测、前端格式检查、Rust 格式检查、Rust 编译检查以及 Web / 桌面前端构建。需要 Node、pnpm、Rust 与当前平台的 Tauri 系统依赖。

`pnpm check` 只检查前端，`pnpm build:all` 只构建两端前端。`pnpm desktop:release` 验证原生发布程序，不能用前端构建成功代替原生构建验收。浏览器回归须使用新的隔离 context 和独立端口，不能操作日常工程页面。具体脚本见 [Scripts 目录](../../scripts/README.md)。
