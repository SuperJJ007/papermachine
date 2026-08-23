# Agent Note：Science Runtime 自动捕获 run 写出的文件

Status: implemented

[English](2026-08-19-science-auto-capture.md) | 中文

## 问题

在本次改动之前，一次 run 的输出只有在模型另外调用 `save_chart` 对一张 PNG 显式导入时，才会成为持久化的 Science artifact。`run_python`/`run_r` 调用在 `SCIENCE_ARTIFACT_DIR` 下写出的其它任何文件——CSV 表格、JSON 摘要、Markdown 报告、纯文本日志——除非模型碰巧按精确路径导入，否则对会话日志完全不可见；而 `save_chart` 的 `SOURCE_RUN_NOT_SUCCESSFUL` 门禁又意味着失败 run 的部分输出根本无法被捕获。

## 决策

Runtime 自身遍历每个 run 的 artifact 目录，把每个合格文件自动保存为带版本的 artifact，无需模型再执行任何步骤。

**捕获挂钩点。** `ScienceRuntime.settlePublishedRun`(`science-runtime/src/index.ts`)新增了一个私有方法 `captureAfterFinish`，在其两处 `science/run-finished` 追加点(同步/静止路径的返回分支，以及非静止分支 `.then()` 的延续)之后、lease 释放之前立即调用。它对每一种终态 `status`——`success`、`failed`、`timed-out`、`cancelled`——都会触发，但绝不会对仅在重放时出现的 `interrupted` run 触发，因为那种状态没有真实的结算事件可供挂钩。

**遍历与过滤。** 新增的 `science-runtime/src/capture.ts` 模块导出 `captureRunArtifacts`，复用了 `walkArtifactFiles`(现已从 `chart.ts` 导出)与 `readBoundedFile`。它新增了一份固定的扩展名 allowlist(`.csv`、`.json`、`.md`、`.png`、`.txt`，映射到各自声明的媒体类型)以及 dotfile/dot-directory 路径 segment 排除规则，二者都不是 Config——它们沿用了既有先例：`ImageAttachmentLimits.mediaTypes` 是一个固定常量，而非 Loader 可配置项。

**版本化与去重。** `logicalName` 是文件相对 `runScratch.artifacts` 的路径，采用正斜杠形式(`plots/loss.png`)；同一相对路径在后续 run 中再次出现，即视为同一逻辑 artifact 的下一个版本。去重并不对候选文件本身求哈希：它总是调用 `saveImage`/`saveText`(幂等、内容寻址)，再把*返回的*不透明 `attachmentId` 与已存在的最新版本相比较——这是同一种品牌类型之间的相等性比较，从不窥探任一字符串的内部结构，不同于在本地对候选文件计算 sha256、再与 `attachment.attachmentId` 比较的做法，后者会构成 `packages/AGENTS.md` 明确禁止的窥探行为("跨边界的不透明 id 都做了品牌化，绝不能当作裸字符串处理")；比较两个新鲜生成、类型相同的引用则绕开了这个问题，且无需额外的本地哈希计算。

**Fold 成本。** 遍历只把会话的 Science fold 重放一次(`foldScience(session.events)`)，而不是每个合格文件都重放一次：每次成功的 `session.append('science/artifact-saved', …)` 都会就地推进同一个累加器(`applyScienceEvent`)，需要时再用 `projectScienceFold` 从中按需推导出公开投影——这正是 `@deepseek-ai/dsh-science-session` 的 `replayScience` 自身一次性执行的组合步骤，现从该包根导出，供这个具体的跨包调用方使用。

**三个新增的 Config 字段**，加在 `dsh-science-runtime` 上，完全遵循既有的 `artifactDiagnosticMax*`/`packagesMax*` 模式(`DEFAULT_*`/`MIN_*`/`MAX_*` 常量、一条 `.step(1).min().max().default()` schema 条目、`resolveConfig` 中匹配的手动校验、`assertKnownKeys` 覆盖新增字段名)：`captureMaxFileBytes`(默认 5 MiB，1–50 MiB)、`captureMaxFilesPerRun`(默认 50，1–1,000)、`captureMaxArtifactVersionsPerSession`(默认 500，1–10,000)。超限文件会被跳过并计数(`skippedOversizedCount`)；per-run/per-session 上限会截断剩余的合格文件并置位标记(`truncatedPerRun`/`truncatedPerSession`)——绝不会使 run 失败，即便部署方自身的 `imageLimits`/`textLimits` 字节上限比 `captureMaxFileBytes` 更小也不会抛出错误(此时 `saveImage`/`saveText` 抛出的 `AttachmentError` 会被捕获并计为超限)。

`ScienceRunResult` 新增了一个可选的 `capture?: CaptureRunArtifactsResult` 字段，只在同步/静止路径上被填充(非静止分支自身的捕获结果没有任何调用方会同步读取，这与该分支的 terminal fact 本就对模型当前回合不可见是同一种不对称)；[retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.zh.md) 把它变成了 `run_python`/`run_r` 追加的回执文本。`CaptureRunArtifactsResult.appendFailed` 标记一次导致遍历提前停止的 `session.append` 拒绝；`captureAfterFinish` 会记录每一次捕获失败，而不是静默吞掉——环境性故障(run 的 artifact 目录消失、权限或磁盘错误)记为 `warn`，其余情况记为 `error`，因为那个残余类别属于 Runtime 自身捕获逻辑的缺陷。两类失败都不会使 run 失败。

## union 拓宽所补齐的持久化模型前置条件

[`science/artifact-saved` replaces `science/chart-saved`](2026-08-18-science-artifact-saved-event.zh.md) 与 [A parallel Text attachment family beside the image family](2026-08-18-attachment-text-family.zh.md) 已经端到端交付了 `science/artifact-saved` 事件、`origin`/`title`/`caption` 字段，以及并行的附件 Text 系列——但没有交付自动捕获所需的 union 拓宽与 fold 层放宽；两篇笔记都把它们标记为推迟。在捕获逻辑能够通过编译或自身的 fold 层 invariant 之前，必须先补上三处缺口：

1. **`ScienceArtifactVersion.attachment: ImageAttachmentRef | TextAttachmentRef`**(`science-session/src/types.ts`)，配合对应的 `codec.ts` schema 拆分(`imageAttachmentSchema`/`textAttachmentSchema`/`artifactAttachmentSchema` union)与 `projection-schema.ts`(`validImageAttachment`/`validTextAttachment`)。
2. **`applyArtifactSaved` 的来源 run 校验从 `status !== 'success'` 放宽为 `status === 'running' || status === 'interrupted'`**(`transition.ts`)——失败/超时/取消的 run 所捕获的文件也必须能成功 fold，因为捕获对每一种终态都会触发。
3. **基于 origin 的溯源，而非所有 artifact 共用一条 `requireToolCall` 路径。** 既有的 `requireToolCall` 会把被引用的 tool call 标记为"已消费"(`state.consumedToolCallSeqs`)，使其不能再支撑第二个 Science fact——这对策展式保存是对的(每次 `save_chart` 调用恰好授权一次提交)，但对捕获是错的：run 自身的 `run_python`/`run_r` toolCallId 早已被 `applyRunStarted` 消费，而一个 run 可能产出多个被捕获的文件。`applyArtifactSaved` 现在按 `artifact.origin` 分支：`'auto'` 要求 `artifact.toolCallId === source.toolCallId && artifact.requestHeaderSeq === source.requestHeaderSeq`(继承自已被证明过的身份，不做新的查找，也不消费)——一个 run 的多个文件共用该 run 的调用；`'model'` 仍旧一如既往地调用 `requireToolCall(..., ['save_chart'])`，消费一次全新调用。
4. **`logicalName` 的解码语法从单个 `SAFE_ID` segment 拓宽为 `SAFE_LOGICAL_NAME`**——以正斜杠分隔的路径 segment，每个 segment 沿用既有的安全 id 语法——因为被捕获文件的逻辑名是一个真实的相对路径(`plots/loss.png`)，而非扁平名称。

这些持久化模型层面的改动，补齐了 [`science/artifact-saved` replaces `science/chart-saved`](2026-08-18-science-artifact-saved-event.zh.md) 推迟的那次 union 拓宽，之所以在这里落地，是因为自动捕获是第一个需要它们的调用方。`save_chart` 既有的模型策展路径不受影响：其默认 fixture 与行为(`origin: 'model'`、一次全新的 `save_chart` tool call)命中的是未改动的 `else` 分支。

**union 拓宽带来的编译连锁反应，由 [retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.zh.md) 解决。** 这里，`tool-science/src/save-chart.ts` 与 `state.ts` 仍假定 `ScienceArtifactVersion.attachment` 总是图片形状，`state.ts` 的 `charts` 字段也把 `projection.artifacts` 过滤为只保留带图片附件的版本，等待那篇笔记记录的后续改动泛化；`ui-science` 的 Details 条目与 Outcome 行在上一层携带同样的收窄。那篇笔记用纯元数据的 `annotate_artifact` 取代了 `save_chart`/`commitChart`，并把 `get_science_state` 的字段泛化为 `artifacts`（覆盖每种媒体类型、`origin`、可选的 `width`/`height`）；`ui-science` 的分类型渲染是另一项单独排期的改动(参见 [per-media-type artifact viewer rendering (csv/json/md/png)](2026-08-19-science-viewer-file-types.zh.md))。

## 异步捕获没有独立的模型可见通知

非静止结算分支除了持久化的 `science/run-finished` 事件本身之外，不会注入任何模型可见的完成事实——没有系统消息，没有侧信道通知。持久化的 `science/artifact-saved` 事件加上模型下一次调用 `get_science_state`，对 v1 而言已经足够；已记录在本包 README 的"已知限制与暂缓事项"中。

## 已考虑过的替代方案

**本地对候选文件求哈希用于去重。** 被否决，改为比较两个 `saveImage`/`saveText` 返回的不透明引用——理由见上文。

**在每次读取前都先做一次 `lstat().size` 的字节数预检查。** 已否决：`readBoundedFile` 本身就已经把内存占用限定在 `captureMaxFileBytes + 1` 以内，与文件真实大小无关，这与 `commitChart` 自身的先例一致(那里也没有单独的基于 stat 的预检查)。同时保留基于 stat 的预检查与读取后的长度检查，会产生一条确实无法测试的重复分支(预检查的结果除非发生一次无法复现的竞态，否则永远不会与读取后检查的结果不同)，却换不来 `readBoundedFile` 本身尚未提供的任何内存安全收益。

**在遍历内部对每个合格文件都重放一次完整的 Session 事件日志。** 已否决：这相对会话总事件数是平方级开销，且没有任何收益——`foldScience` 一次加上每个已追加事件调用一次 `applyScienceEvent`，就能增量地得到完全相同的投影。

**让 `captureAfterFinish` 不做独立的存活性检查，完全依赖 `captureRunArtifacts` 自身对 `session.append` 失败的处理。** 还是保留了外层检查(标了 `v8 ignore`，因为无法在测试中确定性地制造这种竞态)，作为与本文件中每一处调用点在触碰 Session 前都重新校验 `this.ctx.sessions.get(session.id) !== session` 一致的纵深防御。

## 后果

**测试回归，并非捕获逻辑本身导致。** `run.spec.ts` 中既有的"publishes an eventual terminal after the only terminate verb throws but a later observation proves exit"测试假定 lease 会在 `science/run-finished` 变为可观察后同步释放。自动捕获现在会在非静止分支中、在那次追加与 lease 释放之间执行(异步：至少一次 `readdir`)，因此该测试的立即重试开始抛出 `RUNTIME_BUSY`。修复方式是把重试的 `startRun` 调用改为用 `vi.waitFor` 轮询而非直接 `await`，并附上说明重试自身的授权 tool call 是在被轮询的闭包之外只计算一次的，因此多次重试不会重复追加会话事实。

**因 union 拓宽而更新的 fixture**，与捕获行为本身无关：`tool-science/tests/tool-science.spec.ts` 的图表历史上限 fixture 补齐了 `bytes`/`width`/`height`(此前省略是因为该测试只关心排序/省略计数，如今若缺失这些字段就会被 `state.ts` 的图片限定判断整条过滤掉)；两处 `fold.spec.ts`/`fold-transitions.spec.ts` 的错误信息断言更新为改名后的拒绝文案("must reference a successful prior run" → "must reference a run that reached a terminal status")。

**测试覆盖。** `science-runtime/tests/capture.spec.ts`(新文件、变更文件、字节相同的重跑被跳过、超限被跳过并计数、per-run/per-session 上限、dotfile/扩展名排除、对失败 run 的捕获、部署方拒绝接纳被当作超限处理、非文件系统性质的捕获失败记为 `error`、带文件系统错误码的捕获失败记为 `warn`、`science/artifact-saved` 追加被拒绝时在结果上打标并记录日志，以上均不会使 run 失败)；`science-runtime/tests/environment.spec.ts` 的配置测试套件(三个新 Config 字段的边界)；`science-session/tests/fold.spec.ts`/`fold-transitions.spec.ts`(auto origin 在继承溯源下被接受、toolCallId/requestHeaderSeq 不匹配的两个 `||` 操作数各自的拒绝分支、一次文本附件的 fold 往返)；`science-session/tests/projection-schema.spec.ts`(一个合法的文本附件 wire 值)。`science-runtime` 与 `science-session` 中每一个被改动的 `src/` 文件都保持逐文件 100% 的语句/分支/函数/行覆盖率；三处狭窄的 `v8 ignore` 标记了 TOCTOU 式的竞态(遍历得到的文件在遍历与其后的 canonical-path 复检之间被删除或替换；Session 恰好在一次已重新校验过的追加与紧随其后的捕获调用之间那个同步窗口内 detach)，它们真实存在但无法在测试中确定性复现，各自附有行内说明。

**范围说明。** 本次改动不涉及 `save_chart` 的 tool schema、不新增 `annotate_artifact`、不改动 `run_python`/`run_r` 的结果文本——[retire `save_chart`, add metadata-only `annotate_artifact`](2026-08-19-science-annotate-artifact.zh.md) 覆盖了 tool 界面变更与回执文本。它也不涉及任何按媒体类型区分的 viewer 渲染——[per-media-type artifact viewer rendering (csv/json/md/png)](2026-08-19-science-viewer-file-types.zh.md) 覆盖了这部分。
