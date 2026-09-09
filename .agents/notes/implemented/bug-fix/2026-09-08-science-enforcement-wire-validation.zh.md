# Agent Note: 在 Science wire 投影中校验已记录的沙箱强度

Status: implemented

[English](2026-09-08-science-enforcement-wire-validation.md) | 中文

## Problem

Science 环境绑定记录 `sandboxEnforcement`，客户端投影也保留它，但环境的精确键集校验漏掉了该字段。因此 macOS 的 `full` 和 Windows 的 `partial` 都会使其他部分合法的投影报出 `invalid Science projection value`。运行执行和成果持久化可以成功，而实时投影更新和会话历史冷读失败。字段透传测试没有经过接收端的 wire 校验器。

## Decision

环境 wire 校验器仅在可选字段的值为 `full` 或 `partial` 时接受它。精确键集校验保留，没有记录强度的旧绑定仍可读取。事件、检查点和会话格式均不改变；已有会话日志和成果字节无需修复。

可运行的 keyless Science 场景重启 Loader 组合、恢复持久化会话，并通过 `sessionProjections.snapshot` 读取已注册投影，执行与历史读取相同的 wire 校验器。冷读历史快照记录强度和完整计数。单元用例让两种已记录级别经过回放、客户端投影、JSON 序列化和 wire 校验，并拒绝非法值。

[沙箱强度策略](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.zh.md)仍负责规定何时接受较弱的隔离。本修复既不改变该策略，也不改变[冷读轨迹归属](2026-09-02-science-cold-trajectory-ownership.zh.md)；两篇笔记保留各自独立的理由。

## Alternatives considered

**从客户端投影中删除字段。** 拒绝，因为接受的隔离强度是供消费者查看的有意记录的环境事实。

**允许任意环境键或丢弃已保存会话。** 拒绝，因为两者都没有必要：写入端输出的是已声明的合法字段，持久化数据仍有效。保留严格校验可以发现其他格式错误的 wire 值。

## Consequences

已记录绑定在实时和冷读投影中均可读取，不改变沙箱权限。仅有包测试不足以证明可发布：桌面验收包含退出应用并重开同一会话，检查其运行和成果。此前构建的安装包仍包含有缺陷的校验器，必须重新构建才能把修复交付给用户。
