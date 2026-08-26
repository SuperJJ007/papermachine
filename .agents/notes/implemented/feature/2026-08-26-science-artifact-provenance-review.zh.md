# Agent Note：Science artifact 溯源与私有 Review

状态：已实现

[English](2026-08-26-science-artifact-provenance-review.md) | 中文

## 问题

Artifact 溯源曾在每个子视图上方重复同一份生成轮次摘要，而「消息」子视图只留下技术性的请求事实。摘要上的两个动作都通向轨迹表面，因此查看页没有回到原始对话语境的路径。Project artifact store 引入 store 所有的 artifact identity 之前，artifact Review 备注也已被移除。

## 决策

保留溯源面包屑以及「代码」「执行日志」「消息」「环境」四个子视图，删除共享摘要卡。只有「消息」展示生成轮次之前最近的用户文本作为问题，并展示该轮最后一段 assistant 文本作为结果；CSS 把两段摘要各限制为三行，完整内容仍只以对话为权威来源。「回到原始对话」切换到 Chat，并把生成该产物的 assistant-step 语义锚点居中。「查看轨迹」选择详细 Trajectory，并检查来源 run 的调用。

每个 artifact version 现在把 project artifact store 中的生产 Session id 投影到浏览器。当该 id 与当前 Session 不同时，「消息」只把来源 Session 标题渲染为不可交互文本，两个导航动作均不出现。完整跨 Session 导航延后到 project 文件库接管该工作流时处理。

内容查看页恢复按 store `ScienceArtifactId` 键控的私有 Review 备注。专用添加/删除 Remote 追加可忽略的 Session 事件，并由独立 `scienceArtifactNotes` 投影折叠。添加 Remote 校验当前确切可见版本并强制执行 8,192 字符上限；删除 Remote 校验活跃添加事件序号及其 artifact。两类事件都不是 surface 事件，不排入 follow-up，也绝不进入模型请求。Review 备注保留在 artifact 预览旁，不出现在溯源中。

## 考虑过的替代方案

**在溯源页重放完整生成对话**——拒绝，因为 Chat 才是权威语境，复制的对话会与其加载历史和渲染语义发生漂移。有界的问题/结果摘要负责定位；显式动作进入权威的 Chat 或 Trajectory 表面。

**立即把 Review 备注存进 project artifact store**——延后，因为当前查看器由 Session 投影驱动，而 project 级文件库及其浏览器读取通路属于独立改动。Session 内可忽略事件能保留私有备注，同时避免提前定义跨 Session 所有权。

## 后果

Chat 拥有语义锚点滚动与阅读位置保存；conversation service 拥有跨视图挂载的一次性交接。溯源只包含受限的因果摘要与导航，不复制对话。备注在 v1 仅于一个 Session 内持久可见；project 级备注可见性与 store 文件库一并延后。Artifact 事件及其客户端投影保留 `producerSessionId`，浏览器无需根据 run id 推断，即可区分同 Session 与异 Session 溯源。
