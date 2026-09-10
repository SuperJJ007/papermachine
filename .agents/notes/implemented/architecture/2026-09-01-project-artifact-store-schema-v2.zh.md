# Agent Note: 项目 artifact store —— schema v2 与它的 migration

Status: implemented

[English](2026-09-01-project-artifact-store-schema-v2.md) | 中文

## 问题

产物比会话日志存活更久，因此溯源不能依赖重放可能已被删除的生产对话。Schema 增加溯源字段时，旧库行也需要明确解释。

## 决策

Schema v2 让项目库成为内容来源、生产者坐标、环境观察、运行输入、图形状态、注释及显式基线的权威。版本除 latest-annotation 指针外不可变。注释只追加，区分省略、null 和具体值；注释者身份不替换最初捕获身份。完整 `(sessionId, toolCallId, requestHeaderSeq)` 元组在项目范围内由事务消费。

迁移使用有序链，拒绝未知更高版本或缺失步骤，并在外键验证后于成功事务中推进 schema 版本。迁移前 WAL checkpoint 和备份尽力执行；SQL 迁移失败回滚。全新 version-zero 数据库只在初始化完成后标记版本。

历史映射保留不确定性：旧 parent 转为非显式基线；fingerprint 不扩写为虚构观察；名称冲突保留最早链并重命名后续链，不合并；数字环境 revision 转换表示；可选溯源回填失败仅警告；缺失历史溯源保持未知。会话事件保留重放坐标，不建立竞争性的当前溯源库。

## 考虑过的替代方案

**只在日志保存溯源。** 删除会话会抹去长寿命产物的解释。

**原地修改注释字段。** 会丢失旧元数据，并混淆用户注释与内容生产。

**默认前一 ordinal 为基线。** 排序不证明版本由前驱派生。

**把可选日志回填作为迁移前提。** 无法访问旧会话会阻止打开原本有效的项目数据。

## 后果

Schema 迁移不制造历史确定性，也不合并不同产物链。备份失败只是诊断，不能虚称保证存在回滚介质。会话 note 事件与完整会话格式 admission 各有耐久规则；可选历史回填不会让日志重新成为当前溯源权威。

## 相关决策

相关 owner：[project-artifact-store](2026-08-25-project-artifact-store.zh.md); [science-artifact-event-slimming](2026-09-02-science-artifact-event-slimming.zh.md); [science-runtime-provenance-writes](2026-09-02-science-runtime-provenance-writes.zh.md).
