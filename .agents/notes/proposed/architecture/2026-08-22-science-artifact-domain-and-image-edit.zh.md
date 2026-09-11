# Agent Note: Notebook 投影与可移植分析包

Status: proposed

[English](2026-08-22-science-artifact-domain-and-image-edit.md) | 中文

## 问题

可重现 notebook 应解释已记录分析，而不能成为第二个可编辑的会话事实来源。精确产物输入与原生编辑已实现，可移植 notebook bundle 尚未实现。

## 提案

由通过 admission 的会话事件及库引用投影 notebook。按语言和内核 epoch 分组 cell，把源码关联到运行和工具调用身份，保留源码 hash 与精确输入版本。提供完整及切片 ZIP bundle，包含 manifest、README、可运行入口及每内核 notebook。切片必须保留所选输出需要的依赖，不能按最新产物猜测。

已有项目库、输入物化和原生图形编辑提供前提；本提案不重建已移除的 image/text 附件家族，也不承诺支持旧 Science 会话格式。

## 考虑过的替代方案

**把 notebook 变为第二份可写分析历史。** 编辑会偏离会话日志并产生竞争溯源来源。

**只导出最终图片。** 会丢失理解和重现所需代码、精确输入与环境说明。

**不迁移引用就重放全部历史格式。** Bundle 不能靠忽略耐久关系错误来修复它们。

## 验收标准

同一已获准输入的完整及切片导出具有确定内容，验证全部引用，保留代码、运行与工具调用关联，并明确缺失依赖。测试须覆盖多语言、多 epoch、跨会话项目输入、已删除生产者、缺失 blob，以及输入早于首个所选运行的切片。打开 notebook 不能修改原会话。

## 风险

外部副作用、未声明包状态及缺失历史字节可能阻止复现。跨项目导入、保留期及垃圾回收需要明确策略。原生 notebook 导出和确定性打包仍未实现；已有产物编辑不证明这些标准已满足。

## 相关决策

相关 owner：[science-runtime-input-materialization-and-edit-baselines](../../implemented/feature/2026-08-22-science-runtime-input-materialization-and-edit-baselines.zh.md); [project-artifact-store](../../implemented/architecture/2026-08-25-project-artifact-store.zh.md); [science-live-figure-editing](../../implemented/architecture/2026-08-28-science-live-figure-editing.zh.md); [science-required-session-events](../../implemented/architecture/2026-09-10-science-required-session-events.zh.md).
