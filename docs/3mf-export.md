# 3MF 打印导出

制作页的主按钮「导出 3MF」默认输出独立于打印机的 Core 3MF，包含分色实体、名称、毫米尺寸与相对位置；工程分层已落实为几何高度。无需配置模板，即使工程保存了 Bambu 模板也不会自动使用。打印机、耗材及实际切片工艺在切片软件中选择。部分软件不读取标准颜色，需重新指定耗材；Bambu 可能提示仅加载几何，这是通用模型不带其专有工程配置的预期行为。

「Bambu 工程导出 · 可选」默认折叠，只有明确点击其中的导出按钮才使用模板。模板随工程保存、可以更换或移除，不参与默认导出。API 的 `3mf` 和兼容别名 `3mf-generic` 均为通用模型；`3mf-bambu` 才要求模板。底层 `export3MF` 默认不读取工程模板，需要显式传入 `slicerTemplate`。


## Bambu 兼容层

旧版只有 Core 3MF 的 base materials 和几何，Bambu Studio 2.8.2.61 会提示「配置无效，仅加载几何数据」。修复依据对应版本的 [Plater.cpp](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/slic3r/GUI/Plater.cpp)、[bbs_3mf.cpp](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/Format/bbs_3mf.cpp) 和 [Preset.cpp](https://github.com/bambulab/BambuStudio/blob/v02.08.02.61/src/libslic3r/Preset.cpp)。

- `bambu-3mf.mjs` 从模板读取打印机、工艺和耗材参数，写入 `Metadata/project_settings.config`；逐部件耗材编号写入 `Metadata/model_settings.config`，1 起始，与色表一致。
- 原模板颜色完全匹配时使用对应耗材配方，新色号继承首个耗材配方。只调整耗材维度的数组，不把喷嘴、机器限制、工艺数组当作耗材扩展。真正的耗材和 AMS 槽位仍由用户在切片软件选择。
- 开启打印分层时同步工程层高与首层层高，并使用独立工艺名称，防止 Bambu 用安装的同名旧预设覆盖新层高。
- 在模板平台的包围盒中央放置整个装配。各色块共用一个 build item，保持相对高度和位置。异形平台、超出平台的作品和擦料塔位置仍需在切片软件排盘。
- Bambu 只对 `Application=BambuStudio-版本` 读取项目配置。因此适配器保留真实模板的版本标记，同时用 `bs:Generator` 明确记录实际生成器为 Bezier Studio。没有模板时不伪造机型或版本。
- 使用 Bambu 导入器明确支持的 `bamboo_slicer:Version3mf` 别名；其新版 `BambuStudio:3mfVersion` 的冒号后以数字开头，不满足 Core XSD 的 QName 限制。别名同时通过 Bambu 原生导入与官方 Core schema 校验。
- 模板中的旧几何、缩略图、分盘数据、已切片 G-code 文件、账号元数据、网络凭据和后处理命令不进入新工程。机器/耗材配方内原有 G-code 参数保留；旧混色和排序设置清除，清料矩阵交由切片软件按新色表计算。

这里没有图案或机型专用预设。当前提供的 A1 mini 示例配置来自本机用户已经使用的 Bambu 工程，没有编进应用源码。Bambu 首次载入外部自定义预设可能显示正常的预设确认提示；这与「配置无效」不同。用「打开项目」载入才能保留整套设置。

## 几何链路

导出沿用 `compileCreation → buildSolid`，实时轮廓、修改器、分层、切削和制造清理来自同一条链路。在各高度区间按预览覆盖次序划分二维截面，拉伸成互不重叠的分色实体，校验闭合性以及分色体积之和。`material-solids` 管截面，`solid-engine` 管实体，`three-mf` 管标准包，`bambu-3mf` 管切片适配，worker 管计算，`manufacturing-download` 管下载/API base64。

独立色块保留毫米坐标、名称、颜色和源对象关联。无效分色实体停止导出，不回退到丢色整体网格。多个分离实体允许导出，连通数量供用户检查。原 STL API 保留兼容。

原「底板」收为默认折叠的「生成承托部件 · 可选」：创建引用其他对象外形、合并、外扩的普通修改器对象，再纳入通用分层体系。有完整底层轮廓时无须另加。

## 验证

2026-09-15，本机 Bambu Studio **02.08.02.61**：

- 实际 GUI 载入修复文件：不再出现配置无效提示，5 种颜色显示正确，作品居中，层高和首层层高均为 0.2 mm。
- 实际 Bambu CLI 原生读入并重新导出：保留 **69 个部件、5 种颜色、耗材编号 1–5、0.2 mm 层高**。最终文件基于当前 workspace 的 Sandrone-new 工程生成，未覆盖其源文件。
- 浏览器点击打印按钮：下载的包包含 Bambu 配置、69 个部件和 5 个耗材。模板移除、重新载入和从描线工程恢复通过；无页面脚本错误；1440×1000 视口无横向溢出。
- 官方 Core XSD 验证通过；新的模板/分色/多喷嘴隔离/层高/定位检查、TypeScript、生产构建通过。新增模块 scoped lint 通过；旧大型 UI 模块仍有既存 any/React 等 lint 报错，本次没有扩大修复范围。
- 未发送打印任务；实际耗材槽位、排盘、清料和切片质量仍需按打印机检查。

复现：`node scripts/test-3mf.mjs`，随后 `node scripts/test-bambu-3mf.mjs`；`python scripts/validate-3mf.py 文件.3mf`。schema 验证使用隔离安装在 workspace `outputs/3mf/validation-deps` 的 xmlschema。
