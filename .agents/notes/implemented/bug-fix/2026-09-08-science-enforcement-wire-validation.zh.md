# Agent Note: 在 Science wire 投影中校验已记录的沙箱强度

Status: implemented

[English](2026-09-08-science-enforcement-wire-validation.md) | 中文

## 问题

Writer 即使正确记录 sandbox enforcement，严格投影 wire 验证器仍可能拒绝该字段，使执行成功后的冷读取失败。

## 决策

环境 wire 验证器只允许可选 `sandboxEnforcement` 为 full 或 partial，并保留精确 key 验证。绑定没有记录级别时，字段缺失仍有效。测试必须让值经过事件重放、客户端投影、JSON 序列化及接收验证器，包括重启组装后读取持久化历史。

当前 V3 和历史完整会话 admission 由必读 Science 事件 owner 管理。接受该字段不会绕过策略，也不承诺所有旧 Science 格式可读。

## 考虑过的替代方案

**从投影删除 enforcement。** 会对消费者隐藏有意记录的观察。

**允许任意 key 或删除存储数据。** 可以接纳合法字段而不放松无关验证、不抹去有效记录。

**只测试字段传输。** 实际接收验证器仍可能拒绝它。

## 后果

记录的 enforcement 保持可见，不改变 sandbox 权限。包级字段测试不能证明冷产品行为，仍需组装后的持久化及重载证据。发布验证器变化需要重新构建客户端。

## 相关决策

相关 owner：[science-required-session-events](../architecture/2026-09-10-science-required-session-events.zh.md); [science-runtime-minimum-sandbox-enforcement](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.zh.md).
