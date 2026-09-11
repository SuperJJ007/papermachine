# Agent Note: 项目产物库的独立性与耐久性

Status: implemented

[English](2026-08-26-project-artifact-store-s1.md) | 中文

## 问题

项目库必须同时服务实时执行和冷读取，不能依赖哪个会话碰巧先初始化它。

## 决策

带品牌的 project、artifact 和 version id 位于会话层之下。每个接收 project id 的库方法都能惰性打开项目 SQLite，调用者不需要先触发工作区解析副作用。项目事务使用配置的锁超时，串行化 ordinal 分配及注释修改。

Blob 通过临时文件 rename 发布。元数据与 blob 的失败点不同：rename 成功不保证每个目录和数据页都已 fsync。项目库独立于通用会话键值服务，因为两者生命周期、事务和查询键不同。

## 考虑过的替代方案

**每次读取都要求先 resolveProject。** 冷读取和后台读取会依赖无关初始化顺序。

**复用单一会话键值中心。** 项目生命周期与多行唯一性会隐藏在所有权不同的存储里。

**由 rename 推断崩溃耐久性。** Rename 提供发布行为，不是完整断电保证。

## 后果

删除会话仍保留产物数据。元数据提交前遗留的孤立 blob 不会自动回收。如需更强耐久性或磁盘回收，须明确设计完整 fsync 与保留策略；项目身份仍使用解析路径，而非规范化真实路径。

## 相关决策

相关 owner：[project-artifact-store](2026-08-25-project-artifact-store.zh.md); [project-identity-locking](../bug-fix/2026-09-09-project-identity-locking.zh.md).
