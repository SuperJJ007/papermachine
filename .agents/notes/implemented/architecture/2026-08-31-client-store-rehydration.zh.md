# Agent Note: 从初始化字段恢复客户端 store

Status: implemented

[English](2026-08-31-client-store-rehydration.md) | 中文

## 问题

持久化客户端状态可能缺少新增字段或保留临时 UI 状态。整体替换会丢弃初始化默认值；根据初始化 key 自动推断完整 schema，也会丢失初始化器未列出的可选保存字段。

## 决策

对象 store 恢复把保存对象字段浅层覆盖到初始状态上。对象基线拒绝非对象、null 或数组 payload。声明的 transient key 从初始化器恢复，并在序列化时排除。默认合并保留未知保存对象 key，不是原提案中更严格的 key 过滤。原始值和数组 store 仍整体恢复，不增加通用 kind 验证。

需要显式持久化投影的 owner 提供 `persistence.save` 与 `persistence.restore`。Restore 回调验证解析后的 JSON，返回包含允许偏好的完整状态。存储与回调失败不致命。Science 声明 lightbox、view 及轨迹展开状态为 transient。

## 考虑过的替代方案

**每次新增字段都要求升级版本。** 初始默认值可保留已有偏好，无需丢弃它们。

**深合并嵌套对象。** 标签联合及改变的嵌套含义需要 owner 验证，而不是通用结构猜测。

**把初始化 key 当成完整运行时 schema。** 初始化字面量可能不含可选保存 key；更严格投影需要明确 owner 知识。

**仅为浅层合并引入 schema 库。** 没有通用字段规则可执行；有实际验证要求的 owner 使用自己的 restore 回调。

## 后果

已实现新增默认值及 transient 排除，未实现提案要求的通用未知 key 删除与原始值 kind 拒绝。不兼容嵌套值和改变的字段含义仍需验证或版本决策。通用恢复不证明语义合法，自定义 persistence 回调必须拥有完整保存表示。

## 相关决策

相关 owner：[science-native-sidebar](2026-09-10-science-native-sidebar.zh.md).
