# @deepseek-ai/dsh-science-session

[English](README.md) | 中文

Science Session 领域：持久化的 required-on-read Session 事件、严格确定性的 Host 重放、一个 pre-commit invariant，以及可选且客户端安全的 `science` Session projection。本包不暴露变更服务，不启动进程，不观测解释器，不注册面向模型的工具或提示词，也不渲染客户端 UI。Artifact 字节存放在其所属 project 的 artifact store 中(`@deepseek-ai/dsh-science-artifact-store`)；本包自己的 `science/artifact-saved` 持久化事件只携带该 store 的坐标。`@deepseek-ai/dsh-science-runtime` 追加 environment、run 与 artifact 事件；`@deepseek-ai/dsh-tool-science` 绑定 mode 并发布 Outcome。

## 持久化词汇

七个 `science/*` Session 事件，各自 `version: 1`、无损 JSON、携带完整领域值而非补丁，且 required on read（永不 `ignorable`）：`science/mode-bound`、`science/environment-bound`、`science/run-started`、`science/run-finished`、`science/artifact-saved`、`science/outcome-published`、`science/kernel-state`。`science/mode-bound` 只能对已解析 agent preset（创建 header，被最后一条 `agent-preset/selected` 事件覆盖——与 `@deepseek-ai/dsh-agent-presets` 的 `resolveSessionPreset` 采用同一种解析方式）为 `science` 的 Session 合法绑定一次，且必须早于 Science preset 的首个 `step/start`、`request/header` 或 `tool/call` 事实。`science/artifact-saved` 把持久化模型从 chart 泛化开来：一个 artifact version 携带始终填充的 `title`、可选的 `caption`、`origin`（`'auto'` 表示无人值守捕获，`'model'` 表示模型策展）、以及其所属 project store 的坐标(`projectId`、`versionId`、`sha256`、`mediaType`、`byteCount`)——事件用校验和固定内容，project artifact store 负责解析出字节；`logicalName` 是一个以正斜杠分隔的路径(每个 segment 遵循与其它持久化 id 相同的安全语法)，因此被捕获文件相对其 run artifact 目录的路径可以直接作为合法的逻辑名。它可以引用任何到达终态的 run——success、failed、timed-out 或 cancelled——不再局限于成功的 run，因为失败 run 的部分输出同样有资格被捕获。Outcome 保留对先前成功 run、精确 artifact version 和/或 message fact 的非空引用。`science/kernel-state` 是记录某个持久化 kernel 一次生命周期迁移的一次性完整值事实，两个方向复用同一种形状，而不是一对 started/terminal 事件：`state: 'started'` 开启一个由 `language` 与 `kernelEpoch`（session 级别、跨两种语言严格单调递增）标识的 kernel 实例；随后针对同一 `language`/`kernelEpoch` 的 `state: 'exited'` 事实将其关闭，并携带一个闭合联合类型的 `reason` 与一个 `startedAt`（被关闭 kernel 自身 `started` 事实的 `at`，让其生命周期在这条关闭事实中保持完整的一次性值），二者都仅当 `state === 'exited'` 时才会出现。同一语言至多同时存在一个处于打开状态（已 started、尚未 exited）的 kernel。`science/run-started`/`science/run-finished` 固定一次 run 的 `kernelEpoch`，即执行该 run 的那个持久化 kernel 实例，因此共享同一 epoch 的两次 run 就证明了它们共享了内存状态；当 kernel driver 无法完整归因本次 run 已捕获的输出时，`science/run-finished` 可选携带 `outputDegraded: true`。

Artifact version 可选的 `parent: { artifactId, version }` 指名其内容所继承的精确、先前已提交基线；自引用和缺失版本均不合法，且一次就地取代必须保留该版本既有的 parent。`science/run-started` 与 `science/run-finished` 还可以重复由 start 固定的 `inputs` 数组，其中每项固定一个先前已提交的精确 artifact version，以及该 run 保留的 `inputs/` 目录下唯一、规范的路径。字段缺失时可继续回放该字段引入前写入的事件；空数组表示生产方没有提供 artifact version。

### 直接人工编辑版本

除上文两个 run 产出 origin 外，`origin: 'human-edit'` 是第三个严格分支，而不是缺少字段的 run。它要求一个确切 parent 与 Vega-Lite 文本附件，复制 parent 的 environment revision 与 fingerprint，且不携带 `runId`、`toolCallId` 或 `requestHeaderSeq`。fold 只允许它在同一 artifact 当前已提交的 Vega-Lite parent 之上开启下一个连续 version，提交时间须晚于 parent fact 且不晚于自身保存事件；它不能开启 version 1，也不能原地取代一个 version。

## 严格 fold 与 invariant

`replayScience(events)` 把一段完整连续的日志确定性地重放为完整的 Host 侧 `ScienceProjection`，在有效 mode 绑定之前为 `null`。若某个调用方要在一次操作中追加许多 Science 事件(例如 `@deepseek-ai/dsh-science-runtime` 的自动捕获遍历)，可以增量推进同一个 fold，而不必在每次追加后都重放完整日志：先用 `foldScience(events)` 生成一次累加器，再对每个新追加的事件调用 `applyScienceEvent(state, event)`(该事件的 `seq` 必须等于累加器自身期望的下一个序号)，需要公开值时按需调用 `projectScienceFold(state)`——这正是 `replayScience` 自身一次性执行的那三步组合。该 fold 拒绝不连续的序列、格式错误的值、非法转移、逆向来源证明（`requestHeaderSeq`/`toolCallId` 必须指向 mode 绑定之后同类事实中最新的一个）、被复用或已 settle 的 tool call、非单调的 revision 或时间，以及外来证据。一个 version 就是某一轮请求所产出的内容，因此一次重存要么开启下一个连续 version，要么就地取代某个既有 version。`origin: 'auto'` 的保存只有在来源 run 与目标 version 共享同一个 `tool/call.turn` 时才可用不同字节就地取代；`origin: 'model'` 的策展必须逐字节重复目标的 `attachment`。任一来源都可以在任意轮次就地取代未变化的 attachment。`requestHeaderSeq` 仍是授权与溯源信息，而非版本身份：同一条 request header 可以授权不同轮次的调用。自动保存若在新的一轮里改变内容，就必须开启下一个 version；在那里复用版本号会被拒绝。两次重存都保留在持久化日志中——被折叠的只是投影出的版本列表——且该 version 保留的事实会跟随取代它的那个事件，因此针对某个 version 引用的证据，其时间取自真正产出其当前内容的那次重存。fold 本身不做任何基于内容哈希的去重，调用方若想跳过未变化的文件，需要自行在追加前比较内容哈希。一个 `origin: 'auto'` 的 artifact version，其 `toolCallId`/`requestHeaderSeq` 必须与其来源 run 自身的值相等(该值在 run 启动时已被证明)，因为无人值守捕获并非一次独立的模型发起调用，也从不重复消费某次调用——从同一个 run 捕获的多个文件共用该 run 的调用。`origin: 'model'` 的 version 则一如既往，每次都独立消费一次全新的 tool call。一次 kernel-state 事实会为同一个 fold 增加它自己的 pre-commit 规则：其 `kernelEpoch` 必须严格大于该 session 已经接受过的每一个 epoch；当某语言已经存在一个处于打开状态的 kernel 时，一次 `started` 事实会被拒绝，且它必须指名该 session 当前最新的已应用 environment revision，其 fingerprint 须与该 revision 上、对应语言的可用 binding 一致——这与 `science/run-started` 所断言的关系相同，且刻意不对 `exited` 方向作此要求，后者的 revision 改由下文的身份匹配来锚定；而一次 `exited` 事实只有在准确指名该语言当前打开的 epoch、原样重复该 started 事实自身的 `environmentRevision`/`environmentFingerprint`、且携带与该 started 事实 `at` 相等的 `startedAt` 时才会被接受。每条 kernel-state 事实自身的 `at` 都不得超过其提交事件的时间，且一条 `exited` 事实的 `at` 不得早于其 started 事实的 `at`。一条 `science/run-started` 事实的 `kernelEpoch` 必须指名其自身语言当前处于打开状态的某个 kernel，且该 kernel 的 `environmentRevision`/`environmentFingerprint` 与该 run 自身的一致——任何 run 都不得指名一个从未 started 或已经 exited 的 kernel。在已经存在 run 之后，一个已应用的 environment revision 仍可以取代更早的 revision（供后续的 environment-rebound 路径使用），只有当某次 run 仍处于 `running` 状态时才会被拒绝。只有 `session/end-seed` 才会为一个未匹配的运行中 run 或一个未匹配的打开状态 kernel 派生 `interrupted`；不会追加任何合成的 Science 终态事件。包自带的 invariant（`./invariant`）在每次提交前应用同一条适用性规则与严格 fold，因此被拒绝的候选事件不会向持久化日志追加任何内容。

Artifact parent 与 run input 和其它来源证明一样，只能指向先前已提交的事实；package invariant 在 commit 前通过同一个严格 fold 拒绝缺失或前向引用。

## Projection

仅当 `ctx.sessionProjections` 注册表被组合时才注册可选的 `science` key（`ctx.inject(['sessionProjections'], …)`）；未组合该注册表的宿主，或 Standard（非 Science）会话，永远不会携带该 key。公开的 `ScienceClientProjection` 保留 mode、无 path 的 environment capability/version/package-inventory 摘要、run status/history（包括存在时的精确 artifact input）、kernel 生命周期历史、artifact 附件引用、最新 Outcome 与 metrics（包括 `kernelCount`，即曾经启动过的 kernel 实例总数）。一条 kernel 记录携带与其对应的持久化 `ScienceKernelState`/`ScienceKernelInterrupted` 相同的 `language`/`kernelEpoch`/`state` 字段——两个分支共用同一个 `state` 判别字段（`'started' | 'exited' | 'interrupted'`），因此读者只需在这一个字段上做分支判断——包括一条 exited 或 interrupted 事实的 `startedAt`，其完整的 environment fingerprint 被缩减为与 run、artifact 相同的十二字符预览；它不携带任何 Host path，因此不需要再脱敏其它字段。一条 run 记录同样保留其 `kernelEpoch`，并在存在时保留 `outputDegraded`。run 与 artifact 记录保留其授权用的 `toolCallId` 与 `requestHeaderSeq`——浏览器已经持有的 session-log identity——因此客户端无需额外的 Host 路由即可将一次 run 或 artifact version 与其会话记录中的 tool call 关联起来。run 记录还完整保留其 `codeSha256`，与环境指纹不同：它是对同一条会话记录调用已经逐字复述过的源代码文本求的摘要，因此不携带任何 Host 基础设施事实，而溯源需要这一持久化锚点保持精确、不能只留预览。它省略 configured/canonical prefix、executable path 与 identity、完整的 environment 与 package-inventory fingerprint（仅保留十二字符预览）、source/scratch fact，以及 Runtime 自由文本失败。持久化私有状态是 `stateVersion: 9` 的纯 JSON：已观测事件水位线、编码后的严格 fold，以及稀疏脱敏 witness。`checkpointStateSchema` 只在重放 witness 能重建编码 fold 且与外层 `seq` 一致时接纳状态；`checkpointStateSeq` 绑定同一水位线；`viewChanged` 只在真正移动 `lastScienceEventSeq` 时发布公开变化，因为支持性事件可能推进私有水位线却不改变公开值。

公开的 `ScienceClientProjection` 会原样保留 run 的精确 artifact input identity 与路径，以及 artifact version 可选的 parent identity。

run 产出的 artifact 投影保留其授权 run、tool-call 与 request-header 身份。人工编辑版本的投影则保留确切 parent 与直接编辑 origin，不伪造 run 链接；每个确切 artifact version 仍可作为 run input、edit parent 与 Outcome chart evidence。

## Session 附件注册表

本包不向 `ctx.sessionAttachments` 注册任何提取器：`science/artifact-saved` 在 `dsh-session-attachment-index` 的静态 policy 表中被归类为 `attachment-free`，因为该事件根本不携带任何 session 级别的附件引用。因此 Session export 永远不会从 session 日志里收集 Science artifact 字节；所属 project 的 artifact store 是唯一的字节权威，并且比 session 活得更久。

## 模型体验

无，因为本包只校验并投影已经写入日志的会话事实，不触碰任何提示词、消息、schema、流或工具结果；Science 工具 Consumer 是独立包。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与暂缓事项

- **稀疏的 projection witness 保留的是证据链，而非有界窗口。** 它会随保留的 Science 事实增长；不做常数时间或有界历史的承诺，这与通用 `session-projection` 注册表自身 checkpoint 约定中已被接受的取舍一致。
- **Runtime 尚未物化 artifact input。** `ScienceRuntime.startRun` 不写入可选的 `inputs` 字段；本包会校验并投影合规生产方写入的非空 input 事实，但既不读取附件字节，也不写入保留的 `inputs/` 目录。
- **没有设置或当前状态 Details UI。** `@deepseek-ai/dsh-client-ui-science` 渲染 chart 与 Outcome 的会话记录 occurrence；设置和当前状态 Details 条目仍属于后续产品工作。
