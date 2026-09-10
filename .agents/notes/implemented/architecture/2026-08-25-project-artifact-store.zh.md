# Agent Note: Project-level artifact store

Status: implemented

[English](2026-08-25-project-artifact-store.md) | 中文

## 问题

产物应比生成它的对话存活更久，并在工作区移动后仍可发现，同时不应把分析二进制输出提交进工作区。

## 决策

工作区 marker 标识项目；项目的 SQLite 元数据和不可变 blob 位于配置的 Harness home 下。删除会话不删除项目产物。Marker 与项目索引使用解析路径判断移动和复制：旧位置不存在时允许移动，仍存在时把复制识别为新项目。删除 marker 会创建新身份，旧库存数据仍保留。

项目范围的逻辑名称标识产物链；SQLite 事务分配单调递增的不可变版本。溯源、注释、图形状态和显式基线由产物库拥有。会话事件携带重放所需引用。Schema-v2 迁移和原生 V3 事件 admission 各有 owner。

## 考虑过的替代方案

**把产物身份归属到每个会话。** 跨对话复用同一项目产物需要手工合并，删除对话也会删除输出。

**把 blob 存进工作区。** 复制和版本控制会混入无关分析存储。

**相同 marker 一律视为同一活跃项目。** 复制的工作区会静默共享后续输出写入。

## 后果

移动/复制判断是启发式：无法区分未挂载旧位置和真正移动，解析路径也不是基于 realpath 的符号链接身份。删除会话后 producer session id 可能悬空。跨项目导出导入和保留期是独立策略；仅导出会话不保证项目产物库可移植。

## 相关决策

相关 owner：[project-artifact-store-s1](2026-08-26-project-artifact-store-s1.zh.md); [project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.zh.md); [project-identity-locking](../bug-fix/2026-09-09-project-identity-locking.zh.md); [papermachine-installation-isolation](2026-09-10-papermachine-installation-isolation.zh.md).
