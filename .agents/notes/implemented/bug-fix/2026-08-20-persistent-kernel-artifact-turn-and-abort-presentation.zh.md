# Agent Note: 持久化内核来源 run 轮次与 abort 展示

Status: implemented

[English](2026-08-20-persistent-kernel-artifact-turn-and-abort-presentation.md) | 中文

## Problem

同一份持久化内核的 request-header 配置可以授权多个用户轮次。把 `requestHeaderSeq` 当作 artifact 版本身份，会将后续轮次写入的不同文件折叠到更早的可见版本中。

Science fallback 行也把持久化的 post-dispatch `AbortError` 代码 `ABORTED` 显示为执行失败，尽管关联的 Science run 是 cancelled。

## Decision

自动捕获与严格重放只会为字节变化的 `origin: 'auto'` 保存比较 artifact 来源 run 的授权 `tool/call.turn`：不同来源 run 轮次开启下一个版本；同一轮次就地取代既有版本。`origin: 'model'` 是纯元数据，必须保留目标 attachment；任一来源都可以就地取代未变化的 attachment。`requestHeaderSeq` 仍是持久化的授权与溯源字段。

`ScienceToolFallbackRow` 将 `interrupted` 和 `ABORTED` 结果均显示为已中止。`ABORTED_BEFORE_DISPATCH` 仍显示为通用错误，因为没有已派发的 Science run 被取消。

## Alternatives considered

**继续以 `requestHeaderSeq` 作为版本键。** request header 标识的是模型请求配置 epoch，而非一个用户轮次，因此无法区分本缺陷暴露出的持久化内核运行。

**将所有 abort 代码显示为已中止。** dispatch 之前的拒绝没有停止正在运行的 Science 操作，必须保持通用错误展示。

## Consequences

即使模型请求复用同一配置 header，artifact 历史仍按用户轮次排列。持久化日志仍保留 `requestHeaderSeq`，供授权与溯源关联使用。

对 canonical post-dispatch abort，已中止展示现在与持久化的 `cancelled`/`CANCELLED` Science state 一致。组装 Web fixture 在 cancelled Science run 旁重放 `AbortError`/`ABORTED` 的 `run_python` 调用，并同时断言已中止行与持久化 projection。真实 Stop 控件交互仍需要一个可重放的运行中内核 fixture，不能由这份已完成的重放覆盖推断。

## Testing

Focused Runtime capture 证明共享一个 request header 的两个来源 run 轮次会产生 v1 与 v2，而同一轮次的两次 run 会取代 v1。严格重放拒绝跨轮次的字节变化 auto 取代及字节变化的后续 model 策展，同时接受未变化 attachment。组装 Chromium fixture 渲染 v1/v2 run 行小标签与 Details 导航，然后将 canonical aborted run 渲染为已中止，同时重放保留 `cancelled`/`CANCELLED`。UI component 覆盖将 `ABORTED` 固定为已中止、将 `ABORTED_BEFORE_DISPATCH` 固定为错误。
