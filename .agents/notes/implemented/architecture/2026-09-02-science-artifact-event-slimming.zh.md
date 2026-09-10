# Agent Note: `science/artifact-saved` 事件瘦身与"库是权威"的 fold

Status: implemented

[English](2026-09-02-science-artifact-event-slimming.md) | 中文

## 问题

在会话产物事件中重复图形状态和溯源，会让每次重放携带第二份项目数据库并产生竞争权威。

## 决策

产物事件保留 Science fold 所需的不可变引用坐标。项目库拥有字节元数据、来源及注释溯源、图形状态和显式基线。精简不放松环境 revision、生产运行、项目身份及精确引用一致性检查。

原生 V3 中九种 Science 事件都是读取必需事件。单事件 codec 容忍历史字段，不意味着允许打开或重写旧完整 Science 会话；完整会话 admission 和迁移另有要求。已知 Science 事件不能通过 ignorable envelope 退出检查。

## 考虑过的替代方案

**在两处保留完整回执和图形状态。** 副本分歧会让后续注释和会话删除含义不清。

**删字段时一并删耐久关系检查。** 更小的事件将允许与生产环境或运行无关的引用。

**把 codec 接受单事件当作支持历史会话。** 完整日志还要求引用及投影一致。

## 后果

会话重放描述与产物的关系；当前字节和溯源读取查询项目库。即使对话可读，缺少项目数据也可能使产物不可用。宣称支持历史 Science 恢复前，必须重映射全部必需引用关系。

## 相关决策

相关 owner：[science-required-session-events](2026-09-10-science-required-session-events.zh.md); [science-read-remotes](2026-09-09-science-read-remotes.zh.md); [project-artifact-store-schema-v2](2026-09-01-project-artifact-store-schema-v2.zh.md).
