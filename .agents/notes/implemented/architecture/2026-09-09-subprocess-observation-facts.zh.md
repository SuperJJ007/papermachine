# Agent Note: Subprocess 执行位置与字节观测

Status: implemented

[English](2026-09-09-subprocess-observation-facts.md) | 中文

## Problem

Science 持有本地临时路径，必须在接触路径之前拒绝远端 subprocess provider。其固定 Unicode 解释器探针必须区分损坏的输出字节与合法的字面替换字符。

## Decision

subprocess provider 声明执行环境位置。本地报告 `host-local`，E2B 报告 `remote`。Science 在操作私有 Host 临时目录之前检查该事实。

收集读取在替换解码之前报告返回字节片段的 UTF-8 有效性。本地和 E2B 保留原始字节，都报告有效或无效。未知仅用于只保留解码文本的 provider。部分多字节字符在当前读取中无效，而后续完整读取可以有效。

## Alternatives considered

**检查解码后的替换字符。** 合法输入可以包含 U+FFFD，损坏的输入也可解码为相同字符，因此拒绝。

**从服务名称或方法推断位置。** provider 的实际执行位置是显式实现事实，因此拒绝。

## Consequences

消费者无需获得进程 id，即可验证本地归属和字节保真性。现有输出文本、偏移、丢失与溢写行为保持不变。provider 测试覆盖拆分的多字节输入、部分偏移、字面替换字符及损坏字节。

此 RE-APPLY 项涉及 subprocess 声明和本地、E2B provider 的观测。上游保留字节，但未发布这些事实。本提交尚未向上游提交报告。原生收容与代理决定仍各有独立用途，继续有效，均未被取代。
