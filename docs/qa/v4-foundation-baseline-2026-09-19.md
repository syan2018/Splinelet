# V4 基础实施的旧版浏览器基线

日期：2026-09-19。历史验收快照，不代表当前产品承诺，也不代表 V4 验收通过。

## 环境与实际命令

Windows、Node 24.14.0、pnpm 11.26.0、Playwright 1.63.0；独立 Chromium、新 context、本机独立服务，不连接日常页面。

```sh
pnpm test:browser --suite legacy --target web --port 48179 --inspector-port 49230
```

完整运行 14 项，9 项通过、5 项失败，进程以非零退出。通过项：agent-spline-authoring、endpoint-snapping、object-move、pointer-lifecycle、property-navigation、restore-race、selection-scope、spline-endpoints、swatch-delete。

本地完整证据：`outputs/v4-qa/2026-09-19T11-33-21-884Z-47676-d16927d1/manifest.json`。后续单项复现修正了 live-surfaces 的 fixture 映射并增加构建摘要，不能用最后一次单项运行代替完整套件通过。

## 尚未解决的失败

| 用例           | 实际失败与分类                                                                                     | 后续动作                                               |
| -------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| crown-closures | 精确 accessible-name 查找超时；失败 DOM 中仍存在目标 select，不能据此断言 UI 缺失                  | 检查稳定选择器与可访问名称契约                         |
| hair-partition | 期望 15 个面，实际 16；原 fixture 缺少加载所需 image/group，由 runner 补齐必需加载字段后进入原断言 | 对照最小分区几何确认新增面的来源，不能直接改期望数     |
| live-surfaces  | 原 liveSurfaces fixture 无 body-black；映射已提交示例后，其 body-black 有 2 孔，旧断言要求 1 孔    | 提供与测试意图一致的版本化最小 fixture，不能静默改几何 |
| modifiers      | native select 有焦点时 Ctrl+Z 后目标仍为 feature:body-band-64，未恢复预期对象                      | 对照重新构建产物复现键盘撤销边界                       |
| saving         | reload 时 page/context/browser 同时断开，发生于 runner 清理之前                                    | 继续区分 Chromium/OPFS 崩溃与产品逻辑；保存验收不豁免  |

单项证据分别位于 `outputs/v4-qa/2026-09-19T11-38-37-999Z-63096-68cb87dd/`（modifiers）、`2026-09-19T11-39-41-821Z-50760-9359c536/`（saving）、`2026-09-19T11-41-02-782Z-47928-28d273b7/`（live-surfaces）。这些是本机历史产物，不进入 fixture 版本库。新版 manifest 另记录真实构建文件摘要、fixture 摘要、runner 配置及生命周期，避免将 Git HEAD 误当被测构建。

## 签收边界

runner、比较器和 F01/F02 最小缺陷 fixture 已可运行；五项旧浏览器失败仍未关闭，G0b 暂未签收。纯文档/场景/事务模块可继续推进，不以此跳过最终迁移、双端和用户旅程验收。
