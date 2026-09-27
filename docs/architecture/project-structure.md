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
| `docs/`                                                       | 持续维护的使用、接口与架构说明；`history/` 单独保存历史方案和日志     |
| `tasks/`                                                      | 复杂任务总控、模块分发与逐项验收；见[任务目录](../../tasks/README.md) |
| `dist/`                                                       | Web 构建输出                                                          |

根目录的主要目录是 `app/`、`src/`、`public/`、`src-tauri/`、`scripts/`、`docs/` 和 `tasks/`。`dist/` 仅存 Web 构建生成物，不纳入版本控制；桌面前端产物归入 `src-tauri/target/frontend/`，避免 Web 构建清理 `dist/` 时波及桌面产物。

## 依赖与状态边界

`app/page.tsx` 与 `src/desktop/main.tsx` 都引用 `src/components/studio/studio-entry.tsx`，共同加载原有 `studio-app.tsx`。V4 重构在原工作区的数据与命令边界接入，URL 参数不替换整套界面。客户端边界放在共享组件上，Web 路由不承担应用实现，桌面入口不导入 Web 路由组件。`@/*` 映射到 `src/*`。

平面创作与建模面板的 Worker 请求生命周期共用 `src/lib/evaluation/worker-client.mjs`：负责请求配对、发送失败、引擎失效与关闭清理；不拥有工程状态，也不决定求值结果是否仍对应当前工程。工程 revision 与失效结果过滤仍由调用方负责，不能在传输层写回工程。

`src/lib/platform/index.mjs` 提供跨平台下载分派，并导出桌面能力；`desktop.mjs` 封装 Tauri API，`browser.mjs` 负责浏览器下载。工程绑定、打开、保存与恢复的编排仍留在共享应用中。继续提取时应按行为边界拆分，不复制两套保存状态，不改变 `window.traceStudio.call`。

Rust 的 `lib.rs` 装配应用，`commands.rs` 定义 IPC，`files.rs` 管理路径授权与原子文件操作，`open_files.rs` 处理命令行和单实例文件打开。拆分不改变命令名、授权规则和事件协议。

## 构建与兼容资源

`vite.config.ts` 负责 Vinext / Cloudflare Web 构建；`vite.desktop.config.ts` 负责桌面客户端构建。两个构建共享应用源码，分别输出 `dist/` 与 `src-tauri/target/frontend/`，生成目录不纳入版本控制。桌面输出归入 Tauri 的 target，避免 Web 构建清理 `dist/` 时波及它。

桌面交付采用免安装原生程序。`pnpm desktop:release` 使用 `tauri build --no-bundle` 将前端嵌入可执行文件，Windows 产物为 `src-tauri/target/release/splinelet.exe`。Tauri 配置中 `bundle.active` 为 `false`，仅保留应用图标配置；不生成 MSI / NSIS、不安装 WebView2、不自动注册文件关联。目标电脑需自行具备 WebView2 Runtime。用户可手动关联 `.spl`，命令行打开和单实例转交仍由 `open_files.rs` 处理。

`public/trace-worker.js` 继续通过 `/trace-worker.js` 加载，并相对导入 `geometry.mjs`。该几何模块同时供应用和 Node 测试使用，所以桌面构建仍通过 `scripts/build/vite-public-assets.ts` 提供静态资源服务与复制。这里保留一份几何实现，不能直接删除插件或启用普通 `publicDir` 而不验证模块导入。

`/reference.png`、`/sandrone-example.spl`、`/trace-worker.js` 和 `/geometry.mjs` 保持现有路径。模型 Worker 的 `?worker` 与 Manifold 的 `?url` 导入需要双端生产构建验证。
