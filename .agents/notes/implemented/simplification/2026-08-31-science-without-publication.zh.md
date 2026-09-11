# Agent Note: Science 回复不设发布流程

Status: implemented

[English](2026-08-31-science-without-publication.md) | 中文

## 问题

独立的结论发布工具会引导 agent 在回答之后继续发布结果。元素选择覆盖框遮挡正在查看的图表，空白引用标记则让没有颜色的元素看起来具有额外含义。

## 决策

Science 提供执行、状态查看与产物标注。结果通过普通 assistant 回复呈现。发布工具、对应指引以及模型可见状态中的 Outcome 字段均不提供。已通过 admission 的原生 V3 会话保留已记录 Outcome 事件的只读展示；这不承诺旧 V0/V1/V2 Science 会话可打开。

元素引用保留精确身份，但不在 PNG 上绘制覆盖框。只有记录了颜色的元素才在名称后显示色块。显式区域框选仍可使用。空白私有备注输入框包含输入提示与隐私说明，以换行分隔；两者均不会作为备注文本提交。

## 考虑过的替代方案

**只隐藏发布界面。** agent 仍能看到并调用工具。删除生产者与模型指引才能关闭该路径。

**删除已记录的 Outcome 事件。** 已有会话在这些事件旁还包含有用的运行与产物历史。其严格回放与是否提供新发布相互独立。

**保留空色块或图像覆盖框。** 按精确身份引用元素不需要它们，两者都会增加视觉干扰。

## 影响

不会产生新的证据支持的发布修订。重新引入需要同时覆盖生产者、模型指引与展示的明确产品决策。组件测试与产物查看器快照固定图像无遮挡、有色元素的尾随色块，以及仅作为占位提示的隐私文本；工具目录、组装后的 CLI 预设、真实 Web 预设与无密钥快照固定不含发布工具的模型工具列表。

原 R5 与 transcript 布局记录已冻结为历史。当前读取授权、必读事件 admission 及原生布局各有 owner。

## 相关决策

相关 owner：[science-required-session-events](../architecture/2026-09-10-science-required-session-events.zh.md); [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.zh.md).
