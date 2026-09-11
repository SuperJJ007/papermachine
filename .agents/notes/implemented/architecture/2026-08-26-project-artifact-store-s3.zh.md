# Agent Note: 跨会话精确项目输入

Status: implemented

[English](2026-08-26-project-artifact-store-s3.md) | 中文

## 问题

会话可能消费其他会话写入的项目产物，其 ordinal 超过本地投影。若要求所有输入都具有本地历史，会破坏项目级所有权。

## 决策

精确输入优先从本地投影解析，缺失时使用经过验证的项目库版本。本地已知 ordinal 范围内的引用必须与历史一致；超前引用依赖权威库验证，不伪造缺失会话事件。当前会话 cwd 决定 Remote 读取的项目授权。

捕获还查询库 head，避免本地落后的会话重置共享链。编辑基线仍是会话本地引用；扩大输入访问不等于静默扩大所有编辑操作。

## 考虑过的替代方案

**每个项目输入都要求先有本地事件。** 其他会话的合法输出必须先复制到第二份历史才可使用。

**信任任意超前坐标。** 缺少库证明时调用者可以虚构版本。

**推断 latest 为编辑来源。** 项目并发写入会改变 latest 的含义。

## 后果

冷重放可验证记录的引用，而不重建另一段对话。项目共享不授权其他项目命名空间。Ordinal 排序与显式溯源是不同事实；缺少字节仍是读取失败，不能伪造附件。

## 相关决策

相关 owner：[science-read-remotes](2026-09-09-science-read-remotes.zh.md); [science-runtime-provenance-writes](2026-09-02-science-runtime-provenance-writes.zh.md).
