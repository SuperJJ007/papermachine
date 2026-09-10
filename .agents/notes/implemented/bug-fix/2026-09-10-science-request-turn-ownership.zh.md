# Agent Note: Science 请求按已记录轮次归属

Status: implemented

[English](2026-09-10-science-request-turn-ownership.md) | 中文

## Problem

轮次可能在接纳用户消息前失败。按可见用户消息计数会把后续请求分配给错误的 Process 卡片；分页也会使计数不完整。

## Decision

Science Process 以节点日志序号所在的 trace 轮次区间分配请求与引导文本。起止序号均包含在区间内，未结束轮次没有结束上界。不属于任何已记录区间的文本会被省略。只有投影没有 trace 轮次时，才允许按可见消息计数。

[一次发送一个轮次的决策](../simplification/2026-07-17-one-send-one-turn.zh.md) 继续独立规定循环生命周期。展示层使用已记录轮次，不从开始事件推断消息已成功接纳。

稀疏 Science 投影 witness 同时保留模式绑定前的轮次开始与结束。投影状态版本 19 从未修改的 Session 日志重建旧缓存行；否则遗漏的结束事件会让较早轮次一直覆盖后续请求。

## Alternatives considered

统计已加载消息会丢失失败轮次与未加载轮次。时间戳匹配无法区分同时记录的相邻事件。把未匹配文本放入最新轮次会虚构归属关系。

## Consequences

历史页面变化时，请求仍属于已记录的轮次。缺失请求保持不可用，不借用其他轮次的文本。单元覆盖包括已结束与未结束区间、未匹配序号、引导文本和相同时间戳；真实 Web fixture 包含消息接纳前的启动失败，并验证下一轮显示的请求。
