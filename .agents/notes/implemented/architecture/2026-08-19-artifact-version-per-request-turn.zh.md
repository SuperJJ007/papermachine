# Agent Note: 一个 artifact 版本就是某一轮请求所产出的内容

Status: implemented

[English](2026-08-19-artifact-version-per-request-turn.md) | 中文

## Problem

Science 此前把 artifact 版本定义为对某个逻辑文件的一次持久化保存——这是 Runtime 看待自身工作的视角，而不是读者的视角。这一定义带来两个后果，实际使用时二者同时出现。

随附的系统提示词告诉模型：run 写出的文件会被自动捕获，随后请它用 `annotate_artifact` 为"最能说明结果的那个 artifact"加上标题，好让读者看到。自动捕获提交的 v1 以文件 basename 为标题；那次策展调用又把**完全相同的内容寻址附件**作为 v2 重新提交，只是多了标题。于是每一张正常产出的图最终都是两个版本，像素逐字节相同，而 artifact 面板还把这份重复当作版本历史呈现。模型没有做错任何事：提示词要的是一个标题，而持久化模型为此收取了一个版本。

同一个定义也把迭代计入了历史。模型在回答一个请求的过程中调试自己的绘图代码，会把 `chart.png` 重写三四次；每一次重写都变成读者必须翻阅的一个版本，可读者只问了一个问题，只想要一个答案。

## Decision

一个版本就是某一轮请求所产出的内容。来源 run 的授权 `tool/call.turn` 才是这一轮的锚点；`requestHeaderSeq` 仍是授权来源证明，且可以覆盖多个轮次的调用，因此该规则既不需要新的跟踪状态，也不需要新的事件类型。[持久化内核来源 run 与 abort 展示修复](../bug-fix/2026-08-20-persistent-kernel-artifact-turn-and-abort-presentation.md)修正了这一实现细节，同时保留本条面向读者的规则。

`science/artifact-saved` 现在要么开启下一个连续版本，要么就地取代某个既有版本。`applyArtifactSaved`（`packages/science/science-session/src/transition.ts`）只允许 `origin: 'auto'` 在来源 run 与目标版本来源 run 重复同一个 `tool/call.turn` 时用不同字节就地取代；`origin: 'model'` 的策展必须逐字节重复目标 attachment。任一来源都可以在任意轮次就地取代未变化 attachment。

若一次保存在新的一轮里改变了内容，就必须开启下一个版本；在那里复用版本号会被拒绝，同样被拒绝的还有改写 `artifactId` 或把版本 `createdAt` 回拨的取代。两次保存都保留在持久化日志中——被折叠的只是投影出的版本列表——且该版本保留的 `IndexedArtifactFact` 会跟随取代它的那个事件，因此针对某个版本引用的 Outcome 证据，其时间取自真正产出该版本当前内容的那次保存。

两个生产方各自计算版本号，再由 fold 校验。自动捕获（`science-runtime/src/capture.ts`）在来源 run 与当前版本来源 run 共享 `tool/call.turn` 时沿用 `latest.version`，否则递进；它原有的内容哈希跳过逻辑仍会在这两条路径之前丢弃字节级相同的重跑。策展（`ScienceRuntime.annotateArtifact`）提交源版本自身的版本号，因此加标题绝不会推进读者所看到的版本。

`origin` 被保留下来，含义更加精确：它现在描述某个版本**当前**的元数据来源——`auto` 表示由捕获自动加标题的版本，`model` 表示模型刻意加过标题的版本——而不再用于区分两个版本。这正是 artifact 面板优先展示策展结果所需的标记，且它仍是一个两值枚举，两个值都仍会被产出。

`createdAt` 相应地表示该版本当前内容与元数据的提交时刻，而不是某个不可变附件最初落盘的时刻。

## Alternatives considered

**新增一个只承载元数据的 `science/artifact-annotated` 事件。** 这是最初仅针对重复版本缺陷起草的修法，也是更窄的变更：标注成为 fold 施加到指定版本上的一层覆盖，内容路径仍保持"一次保存，一个版本"。它能修好 v1/v2 重复，却修不了迭代噪音——同一轮里的四次 run 仍会产生四个版本。它还要付出一个新的 `SessionEventMap` 成员及其 codec、projection schema 与客户端渲染的代价：比被采纳的规则多出更多持久化面，却只解决了问题的一部分。被采纳的 model-capture 规则通过要求标注附件不变来保持标注只承载元数据。

**只改提示词，让模型少调用标注。** 半小时的工作量，却让数据模型继续把版本定义为一次保存。任何遵循随附指示、为最佳结果加标题的模型仍会铸出一个字节相同的版本，于是只要模型照做，缺陷就会重现。

**在 artifact 面板里折叠字节相同的相邻版本。** 纯展示层的处理，而且并不诚实：持久化日志、`get_science_state` 与 `annotate_artifact` receipt 仍然都说是 v2，于是模型推理所依据的版本，读者根本看不到。

**保留轮内的多次迭代，嵌套在该轮的版本之下。** 能保住被取代所丢弃的中间产物，代价是 projection 与面板各多一层结构。之所以否决，是因为这些中间产物是模型的调试残渣而非结果，而且它们仍可追溯：每一次保存都留在 session log 中，每一次 run 也都保有自己的 transcript 行。

## Consequences

一轮请求对每个逻辑 artifact 只产出一个版本，因此面板的版本列表读起来就是读者自己提出请求的序列——"画个散点图""加上回归线""改成对数坐标"——而不是其背后逐次运行的迭代过程。`annotate_artifact` 则完全不再消耗版本。

所放弃的东西：某一轮内被写出又被覆盖的中间文件，不再能作为一个版本被访问。被取代的那次保存仍在持久化日志中，写出它的 run 也仍保有 transcript 行，但没有任何投影面会列出它。想要在 artifact 面板里对比模型第三次与第四次尝试的读者，将无法做到。

fold 新增了一条生产方现在可能触发的拒绝：从较晚的一轮里以既有版本号提交已改变的内容会明确失败，而不是悄悄覆盖读者已经看到过的结果。

对既有 session 的影响，只存在于发布前阶段唯一重要的那个意义上——不存在任何磁盘迁移，而按旧规则记录的日志仍可正常 fold，因为其中每个版本都是连续递进的。

## Testing

`packages/science/science-session/tests/fold.spec.ts` 覆盖同轮取代（包括保留事实迁移到取代事件上）、跨轮的未改变附件策展、跨轮内容变更的拒绝，以及改名与时间回拨的拒绝。`packages/science/science-runtime/tests/capture.spec.ts` 证明同一轮内的第二次 run 是取代而非新增版本，并保留该轮的最终内容与两次持久化保存。`science-tools` headless 快照是组装后应用层面的证据：其 transcript 现在从策展 receipt 中报告 `v1` 并引用 `chart@1`，且其 mock 模型从 receipt 推导被引用的版本，而不再取自 fixture 常量，因此该 fixture 自身不再写死任何版本号。
