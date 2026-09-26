# 工作包 2：源线交互与调度

范围：source drag/runtime gesture、editor session/display projection、evaluation broker、CreationWorkspace 的 busy 边界。保持原 UI、命令权威、预览取消及单步撤销语义；本包不改区域文件协议。

- [ ] 源手势只投影局部改动，不在每个 pointer 更新复制全工程或重新投影完整 creation view。
- [ ] 松手提交一次；Esc、失焦、换工具、打开文件和撤销正确丢弃手势。
- [ ] 求值调度最多一个在途任务及一个最新待处理请求；连续输入不排队全算旧 preview。
- [ ] 输入源线即时显示；最后接受的派生面仅作为 pending 预览，不允许以旧面提交赋值或导出。
- [ ] pending 按依赖输出控制操作，其他源线和不相关操作可继续。
- [ ] Web/Desktop 共用接线，epoch/revision/previewId/previewVersion 拒绝过期结果。

验收：fake worker 验证合并顺序、跨工程和旧响应竞态；隔离浏览器连续 100 次 pointer 输入时不积压 100 次区域求值，最终几何等于对最终作者态的冷求值，撤销仅一次。30 次测量目标为源线输入至绘制 p95 不超过 33 ms，单次同步手势工作 p95 不超过 16 ms；这是待验证预算，不是当前能力或跨硬件保证。派生区域延迟单列，不能用它掩盖源线卡顿。
