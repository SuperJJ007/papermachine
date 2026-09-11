# Agent Note: Science Runtime 物化 artifact input 并指定 edit baseline

Status: implemented

[English](2026-08-22-science-runtime-input-materialization-and-edit-baselines.md) | 中文

## 问题

分析必须读取请求的字节，不能暴露产物库路径，也不能把复制的输入误认为新输出。

## 决策

Runtime 在发布运行前解析所有精确版本，并验证安全相对路径、冲突、数量及编辑基线。输入物化在独立于产物输出的目录中。`store.readBlob` 提供字节；总字节限制按实际读取量累计，不信任库中大小元数据。准备期间检查取消，失败则删除临时文件。

跨会话输入可以从项目库解析。编辑基线仍须为会话投影中的精确引用。基线映射保留到捕获阶段，使产物库记录显式 `baseVersionId`；不会推断 latest 就是预期来源。字节相同的输出仍遵循捕获去重。

## 考虑过的替代方案

**直接把私有库路径交给代码。** 会暴露实现路径，并绕过每次运行的输入目录。

**把输入放进 artifacts。** 捕获会把复制的输入重新认作新输出。

**仅验证声明大小，或未全部解析就启动。** 错误元数据或晚发现的缺失输入会绕过预算，或启动不完整请求。

## 后果

输入准备是全有或全无，不增加 driver 协议。选择精确版本不意味着允许任意跨项目访问。基线关联记录用户意图，与 ordinal 排序分开。

## 相关决策

相关 owner：[project-artifact-store-s3](../architecture/2026-08-26-project-artifact-store-s3.zh.md); [project-artifact-store-schema-v2](../architecture/2026-09-01-project-artifact-store-schema-v2.zh.md).
