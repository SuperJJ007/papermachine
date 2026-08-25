# Agent Note：Science 对话流过程细节 chrome 的收纳

状态：已实现

[English](2026-08-25-science-transcript-chrome-suppression.md) | 中文

## 问题

对 Science 对话流做屏幕实测，发现聊天列中仍平铺着五类过程性内容：上下文注入展开行、完整的 Think 块、未折叠的非 Science Tool 调用行、逐轮的用时/TTFT/吞吐文字，以及独占一行的分支可用性提示。[Part 3](2026-08-25-science-trajectory-and-transcript-ia.zh.md) 已经折叠了 Science 自身的 `run_python`/`run_r`/`annotate_artifact`/`publish_outcome` 行，并把 artifact 卡移到了轮末；本笔记覆盖用户真实截图点名的这五项中尚未处理的部分。

动手前先查了现有代码，发现五项里有三项其实早已满足：Think 块默认就折叠成一行摘要（`ReasoningRow`）；每一个非 Science 的 Tool 调用早已通过 `ui-tool` 的通用 `ToolRow`（`GenericToolCard` 兜底分发，以及建在同一原子组件之上的每个专用 toolview）折叠；分支不可用提示也早已只在分支按钮上以 Tooltip 出现，外加一段仅供屏幕阅读器读取的描述，从不占对话流一行。真正仍然常驻不收的，只有上下文注入行和逐轮计时文字这两项。

## 决定

剩下这两行都是只应由 Science 改变的对话流行为：`ui-conversation` 是其他产品无需 Science 也会加载的通用包，而每一份非 Science 的 web e2e golden（turn-tail-actions、message-actions 及另外 30 多份）都合理地保留着这两行——让它们在 Science 里显得多余的，是 Science 自己更密集的呈现（折叠的 Tool 单元格、轮末 artifact 组），而非一个产品级的通用决定。

`ui-conversation` 的 `conversation.chat.node` slot 声明在既有的 `turnData` 工厂旁再添一个 Hook：`processDetailVisible`，由 `ConversationController` 上新增的 `IConversation.registerTranscriptDetailVisibility(source)` 支撑，形态与既有的 `registerViewVisibility`/`ViewVisibilitySource` 完全一致（一个 `visible(sessionId)` 判定加 `subscribe(callback)` 失效通知）。`ContextMessageNodeView` 调用该 Hook，答 `false` 时返回 null——不是折叠成一行，而是完全没有 DOM 落地，因此也不会留下类似 `[data-turn-tail]` 那种空 flex-gap 占位。`TurnTailNodeView` 调用它来决定是否把 `runMs`/`ttftMs`/`tokensPerSecond` 传给 `MessageIconActions`；纯时钟本身始终渲染，因为一个裸时间戳并非 brief 点名的「计时元数据」。`ui-conversation` 在默认情况（无注册方）下无条件渲染两者，且从不引入 Science；`ui-science` 是唯一的注册方，提供 `createTranscriptDetailVisibilitySource`——与 Trajectory 泳道子视图已在用的「该会话是否具备泳道资格」同一套响应式判定取反，因此获得泳道的会话也随之失去这部分 chrome。

选择这个既有扩展点形态（`registerViewVisibility`、`registerSubmissionHandler`）而非 keyed-slot 遮蔽：若遮蔽 `conversation.chat.node` 的某个 key，遮蔽方组件要么得复刻 `ContextMessageNodeView`/`TurnTailNodeView`，要么得跨包引入它们，而 `packages/client/AGENTS.md` 的导出纪律明确禁止跨插件边界引入另一插件的实现组件——唯一认可的路线是 slot 系统与 ctx 服务，经由 slot 级 `inject` 面挂载的 Hook 正是 slot 系统本身。

## 考虑过的替代方案

**在 `ui-conversation` 里无条件收起。** 已否决：32 份以上既有的非 Science web e2e golden（skill 调用、subagent、workflow、实时交互等场景）都展示着这两行，没有理由丢掉；全局移除还会删掉基础 harness 开发体验仍需要的调试可见性。

**从 `ui-science` 用跨包组件引入来遮蔽 `conversation.chat.node` 的 key。** 被 `packages/client/AGENTS.md` 的导出纪律否决（`ContextMessageNodeView`/`TurnTailNodeView` 是内部实现，原则上禁止跨包引入另一插件的实现）；改为经共享 Hook 复用则完全不需要引入，只需给两个组件本就开放的 props 各加一个可选字段。

**直接在 `ui-conversation` 的组件内读取 `science` 会话投影。** 已否决：这会要求 `ui-conversation` 引入 `dsh-science-session` 的类型合并，把 Science 感知硬编码进每个非 Science 产品也会加载的包里。

## 后果

`ui-conversation` 多了一个新的能力接缝（`registerTranscriptDetailVisibility`），其形态与响应式契约与 `registerViewVisibility` 完全相同，未来的领域包可以照同一套方式组合，无需再造一个专属注册表。被抑制的内容仍可从持久日志重建：上下文行经由 Trajectory 的详细子视图（本就独立于对话流的构建器），计时数字经由 composer dock 的全会话统计条（一个不受本次抑制影响的聚合 `sessionStats` 投影）。一个新的 keyless web e2e 场景（`science-transcript-chrome.e2e.ts`）针对一份手工构造的确定性会话 fixture 端到端证明了这两项抑制——无需 LLM 录制；而既有的 `turn-tail-actions`/`message-actions` golden 则证明非 Science 会话未受影响。

供后续参考的对话流最终形态定义：用户消息、assistant 文字、折叠的过程单元格（Think、Tool 调用、Science 自己的执行/结论单元格），以及一个轮末 artifact 组——仅此而已。本次改动之前就已满足的几项（Think 折叠、通用 Tool 折叠、分支提示）不需要代码改动；记录在此只是为了让未来的读者不会把它们重新诊断成缺口。
