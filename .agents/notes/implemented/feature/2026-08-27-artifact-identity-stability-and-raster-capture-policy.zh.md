# Agent Note: Artifact 身份稳定性与光栅捕获策略

Status: implemented

[English](2026-08-27-artifact-identity-stability-and-raster-capture-policy.md) | 中文

## 问题

流式投影替换可能重复触发相同产物读取，自动栅格捕获也无法安全推断分析要发布哪些文件。

## 决策

产物读取以不可变版本身份为键，不以新分配的投影对象为键。Promise 缓存有界，并移除失败读取，使暂时故障可以重试。无关会话状态改变时，原生产物 pane 保留精确版本参数。

栅格捕获使用显式 `raster_artifacts` 声明。声明的 PNG 按策略获得捕获资格；诊断文件可以放在产物目录之外。跳过的栅格体现在工具捕获结果中，不仅为描述跳过而新建耐久事件。

## 考虑过的替代方案

**按投影对象身份索引读取。** 流式分配会使未改变的字节请求失效。

**对重复读取 debounce。** 只延迟症状，不修复身份。

**捕获全部图片或根据文件名猜测。** 临时诊断会成为项目产物，并由命名惯例推断科学意图。

## 后果

流式更新期间精确版本选择保持稳定，可重试故障不会污染缓存。声明只提供资格，不保证文件存在或通过字节与类型限制。主动不声明的输出不会由栅格捕获发布。

## 相关决策

相关 owner：[science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md); [science-auto-capture](2026-08-19-science-auto-capture.zh.md).
