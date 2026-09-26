# 数据流维护与示例验收

日期：2026-09-26。承接[数据流审计](data-flow-audit-2026-09-26.md)与[身份查询优化](identity-optimization-2026-09-26.md)。本文是本机验收快照，不是跨设备耗时或实物打印保证。

## 数据边界修复

- 多个旧 Feature 使用同一 Region：各自建立 `region-reference` 实例，保留独立输出身份、厚度和附着关系。回归确认两个重叠区域分别位于 0 / 5.4 mm；支撑厚度从 5 改到 7 mm 后，上层跟随到 7.4 mm，保存重开不丢失关系。
- 迁移完成后实际检查发布区域、浮雕与制造放置；自附着等 schema 合法但无法求值的工程产生明确警告，仍保留可修复作者态。
- Studio 会话保留不可变迁移报告，顶部可展开 warning/error；重新打开原生 V4 清除旧报告。报告不写入工程几何或历史 DTO。未发布支撑造成的固定高度转换明确提示后续不再联动。
- 原工作区改用只读 `StudioDisplayProject`，不再冒充旧 Project。SVG/Blender 共用最小只读源曲线导出服务，与重构前输出逐字比较通过，未复制两套模板。
- 已绑定契约的分区不再反复提示“首次分区”。末段从底面内穿到外部时，明确提示无需自动接边；内部真实缺口和主动禁用继续保留各自诊断。仅调整诊断，没有改动接边几何与容差。

## 示例来源与结果

用户提供的 `C:\Users\Syan\Desktop\桑多涅无料\Splinelet-final.spl` 首先复制到本机 `outputs/sample-maintenance-2026-09-26/source.spl`，再更新 `public/sandrone-example.spl`。三者最终 SHA-256 均为：

`b05bcc4c2fc9683782b1d01a4a528b5fe61b46d936755ed14b9a05b64acef4ce`

原件未修改；来源曲线、签名、杯上纹样和工程参数均保留。检查确认不需要为通过验收移动艺术路径。旧示例归入 `scripts/tests/fixtures/legacy-sandrone.spl`，SHA-256 为 `0997dd9a6d41ae21def3e1555c0be4286668a29f4273fa4e9758c188cc883a86`；历史迁移基线与当前示例各自验证。

| 项目       | 结果                                                                 |
| ---------- | -------------------------------------------------------------------- |
| 格式与资源 | 原生 V4；1 个资源；文档、资源稳定往返                                |
| 作者态     | 15 个节点（14 Shape、1 Group）、82 条源路径、263 个算子              |
| 发布与绑定 | 73 个唯一输出；70 个外观、73 个浮雕、46 个制造赋值均唯一解析         |
| 求值       | 曲线、区域、浮雕、制造放置、实体均 ready                             |
| 实体       | 24,080 三角形；12,042 顶点；1 个连通分量；无无效边及零面积三角形     |
| 尺寸       | 约 80.445 × 97.289 × 5.200 mm                                        |
| 体积       | 主体 16,748.101665 mm³；分色总和 16,748.082683 mm³，差值在校验容差内 |
| 导出       | 5 色、73 个材料网格；通用 3MF 592,530 bytes；Bambu 3MF 633,986 bytes |
| 权威保护   | 求值和双格式导出后重新编码，与初始编码逐字相同                       |

杯缘分区线末端距离边界 0.166903 mm，超过其 0.1 mm 自动接边容差，但它已经穿过边界。末端延长 1 mm 后 8 个分区面的最大面积差约 `1.38e-10 mm²`；裁至实际边界交点也保持一致。这是有效的越界切线，不能仅凭“未连接”字样擅自移动源点。

## 验证与证据

可重复校验命令：

```sh
node scripts/validation/verify-example.mjs
node scripts/validation/verify-example.mjs --input public/sandrone-example.spl --output-dir outputs/example-validation
```

通过：`pnpm typecheck`、`pnpm lint`、`pnpm test`（145 项）、`pnpm test:core`、`pnpm test:export`、`pnpm build`、`pnpm desktop:build`、`pnpm desktop:format:check`、`pnpm desktop:check`。最后的诊断调整另跑分区接边、旧分区动态联动、完整链路及示例校验。

隔离浏览器通过：原 Studio 编辑/撤销/保存重开/迁移提示、身份性能用例，以及实际桌面前端 SVG 导入/笔画宽度/变换/撤销。新示例已有同名签名组，测试改为按新增节点身份定位，避免误选原艺术内容。Studio fixture 遇到 Vite 首次依赖预优化 504 时只允许一次受控重载，保留其他页面错误。

本机 12 次颜色、厚度和撤销操作：区域更新提示平均 798.87 ms，最大 890.10 ms；Worker 平均 525.81 ms；输入到绘制平均 1,375.27 ms。使用较旧示例的历史前后对比见身份优化记录，本次不同示例的数据不直接作为优化百分比。仍有主线程投影与绘制成本，并非所有操作都已瞬时完成。

本机证据目录：

- `outputs/sample-maintenance-2026-09-26/final/`：检查报告、两种 3MF、原生示例二维/三维截图与无页面错误记录。
- `outputs/v4-qa/sample-maintenance-2026-09-26-original-studio-passing/`：完整 Studio 旅程。
- `outputs/v4-qa/sample-maintenance-2026-09-26-identity-performance/`：12 次交互计时。
- `outputs/v4-qa/sample-maintenance-2026-09-26-desktop-vector-final/`：桌面前端交互。

`pnpm format:check` 仍报告 313 个既有文件；与上一轮 335 个问题文件比较无新增。本轮所有修改/新增文本文件的格式检查及 `git diff --check` 通过，未批量格式化无关文件。新示例未在实际打印机上打印，本轮 Bambu 验证覆盖生成包与配置结构，未宣称完成外部切片质量验证。
