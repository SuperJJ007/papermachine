# Agent Note: DSH Science v0.1 R5 图表与 Outcome

Status: implemented

[English](2026-08-16-dsh-science-v01-r5-charts-outcome.md) | 中文

## Problem

R4 已在验收通过的 Session、Runtime 与模型工具层之上交付可选的 Science preset，但一次成功分析仍只能以进程输出与普通文字结束。持久化的 `science/chart-saved` 与 `science/outcome-published` 词汇当时已经存在，却没有可信生产方提交任一事件，也没有 Web 组件渲染这些值。模型可以在 `SCIENCE_ARTIFACT_DIR` 下写入 PNG，却不能把这个私有 run 文件变成可回放的图表附件，也不能发布带引用的 Outcome。

缺失的工作不是通用图表库，而是 Science 自己负责的完整路径：从一次成功 run 的私有产物，到不可变附件、持久图表版本、带引用的 Outcome revision，以及可访问的 Web transcript。该路径必须保留 R1-R4 已确定的归属：Host 路径保持私有，Session log 继续是状态权威，Runtime 拥有自己的 scratch tree，附件字节必须先持久化再发布引用，而 Science preset 在已交付的纯文本 DeepSeek route 上仍然可用。

直接返回带图片的工具结果会违反最后一条要求。`ImageBlock` 会成为模型可见历史；手写 DeepSeek adapter 会明确拒绝图片而不是丢弃，所以保存一张图就可能让下一次 Science 请求失败。只在工具 presentation metadata 中存一个裸 attachment id 也不完整：附件读取与 Session ZIP 导出只授权受认可的持久内容载体中的引用，并且 Science 事件与 `tool/result` 之间若发生崩溃，已经验收的图表会变得不可读取。

## Decision

发布工具的当前可用性由 [Science 无发布流程](../simplification/2026-08-31-science-without-publication.zh.md)规定；本记录保留附件授权与已记录事件回放的依据。

R5 在验收通过的 R4 收口 head `fb04b0d273a6d4d3a319a4e8243c44953010f930` 上实现 `SCI-CHARTS-OUTCOME` 切片。它为已交付的 Science preset 增加直接工具 `save_chart` 与 `publish_outcome`，为 Runtime 增加从自有成功 run 导入 PNG 的操作，增加用于领域 Session 附件引用的通用 registry，并增加渲染图表与 Outcome 工具 occurrence 的 `ui-science` Client Plugin。该 range 不包含 settings、sidebar、prefix 管理、environment mutation、Desktop carrier、provider release 或 package publication 工作。

R5 明确采用双表面策略。模型侧 `save_chart` 结果是有界文字 receipt，包含图表 identity、version、source run、尺寸、字节数与标题，不包含 `ImageBlock`。Web presentation 读取同一个持久 `ImageAttachmentRef` 并渲染 PNG。`publish_outcome` 将已发布的标题、Markdown 摘要、evidence references 与 revision 作为模型可见文字返回，并在专用 Web row 中渲染同一 publication。模型若确实需要检查像素，仍在明确支持图片的 route 上使用 `read_image`；保存与展示图表本身不要求这种 route。

### 精确身份与依赖顺序

| Subject | Identity or rule | R5 use |
|---|---|---|
| 已验收产品基线 | [R4 closure](2026-08-16-dsh-science-v01-r4-science-preset.zh.md) head `fb04b0d273a6d4d3a319a4e8243c44953010f930` | 准确实现基线 |
| R5 inventory row | [`SCI-CHARTS-OUTCOME`](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.zh.md) | 唯一产品 delta |
| 持久词汇 | [R1](2026-08-15-dsh-science-v01-r1-science-session.zh.md) `science/chart-saved`、`science/outcome-published` values 与严格 transitions | 复用，不增加第二个 chart 或 Outcome authority |
| Runtime 归属 | [R2](2026-08-15-dsh-science-v01-r2-science-runtime.zh.md) 私有 Session/run scratch 与 exact-session lease rules | 为 artifact import 扩展；不暴露 Host path |
| 模型 Consumer | [R3](2026-08-16-dsh-science-v01-r3-science-tools.zh.md) `@deepseek-ai/dsh-tool-science` | 在现有三个工具旁增加两个直接工具与 guidance |
| 已交付 composition | [R4](2026-08-16-dsh-science-v01-r4-science-preset.zh.md) literal `science` preset 与 Web/CLI snapshot | 加入两个工具和 Client/Host rows；在 R5 阶段 Runtime row 仍由部署拥有（[R6](2026-08-17-dsh-science-v01-r6-settings-details.zh.md) 之后只在 Web bundle 中挂载它） |
| 下游 source | 无 | R5 是全新的 RC5-line 设计，不继承下游实现或证据 |

规划曾把 R5 拆成三个检查点——domain-neutral registry、Science 生产端、Web presentation——并要求在各自独立的 head 上验收。实现最终以一条按同样依赖顺序排列的六提交序列落在 R4 head 之上，所有 gate 都在最终合并 candidate 上运行，而不是在三个分别验收的 head 上运行。[dated R5 evidence record](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.zh.md) 把每项结果绑定到该 candidate，并记录这一偏差。

### Session 附件引用归属

`packages/session/session-attachment-index` 下的 `@deepseek-ai/dsh-session-attachment-index` 提供 `ctx.sessionAttachments`，作为从 Session events 提取可信附件引用且由 effect 管理的唯一实现。它的内置 extractor 吸收了 direct content、wrapped message、inserted message、completed assistant chunk 与 nested tool-result image carriers；`api-proxy.ts` 与 `session-export.ts` 中的本地 scanners 已删除，两个调用点都消费该 registry。领域包可以为某一 event type 注册 extractor；extractor 校验该事件自身的持久字段，并返回完整 `ImageAttachmentRef`，绝不只返回 id。

该包还拥有一份覆盖 `KNOWN_SESSION_EVENT_TYPES` 的完整 attachment policy，由两份封闭清单分类，并针对生成的 known-type set 执行 freshness gate。每个已知 event type 恰好分类为 built-in、attachment-free 或 extractor-required；新增已知 event 却没有 policy 时该 gate 失败。`science/chart-saved` 属于 extractor-required。若日志包含 extractor-required 的已知类型，但所属 registration 不存在，附件读取以 `SESSION_ATTACHMENT_EXTRACTOR_MISSING` 失败，Session export 则在输出不完整 ZIP 前失败。未知的 ignorable events 不授权任何内容；已注册已知类型中的畸形数据会使 extraction 失败，而不是降级为空结果。

`@deepseek-ai/dsh-science-session` 注册 `science/chart-saved`，并只在现有严格 Science decoder 接受该事件后返回 `chart.attachment`。`@deepseek-ai/dsh-host-apiproxy` 只通过该 registry 完成 session-authorized attachment read 与 Session ZIP media collection。因此，即使后续 `tool/result` 不存在，同一个已接受 chart event 仍会授权 browser replay 与 archive export。`tool/call` arguments、任意 JSON、另一个 Session、attachment-free event 或未知 ignorable event 中的引用都不授权字节。

该 registry 是通用能力，因为持久插件事件可以正当地拥有不可变附件，而 authorization 与 export 不应 import 每一个产品领域。它不是第二个 attachment store、projection 或 garbage collector。`ctx.attachments` 仍是唯一字节 owner 与 integrity verifier；`ctx.sessionAttachments` 只回答一个 Session log 持久命名了哪些完整引用。Web Host 同时挂载 registry 与 `@deepseek-ai/dsh-science-session`；后者由 chart presentation 与 attachment authorization 获得具体 production reader，同时其现有 `science` projection 通过普通 projection carrier 到达 `ui-science`。

### `save_chart` 与 Runtime artifact import

`ScienceRuntimeService` 通过一个操作从准确 live Session 提交图表。request 携带 Session、成功 `runId`、以 slash 分隔的 artifact-relative path、logical name、title、可选 caption、授权 tool call id、最新 request-header sequence 与 cancellation signal。公开 request 与 result 不包含 Host path 或可变 byte buffer。

模型侧工具接受以下字段：

```ts
interface SaveChartArgs {
  run_id: string
  artifact_path: string
  logical_name: string
  title: string
  caption?: string
}
```

`artifact_path` 相对于该 run 的 `SCIENCE_ARTIFACT_DIR`。版本一只接受由正斜线分隔的 segments，并拒绝空路径、`.`、`..`、反斜线、absolute 或 drive/UNC forms、NUL，以及超过持久路径上限的值。解析后的 entry 必须是普通非 symlink 文件，其 canonical location 仍在 source run 的私有 artifact directory 内。source run 必须已持久成功，并且其 `science/run-started` event 必须满足 `startedSeq >= (session.header.seedLength ?? 0)`。这个不可变 fork-lineage predicate 是唯一的本地 run 边界：resume 不改变 `header.seedLength`，继承 run 则满足 `startedSeq < header.seedLength`，可以被 Outcome 引用，但不能从 child 的私有 scratch 导入。

artifact selection 失败时，diagnostic 会从该 run 的 artifact directory 列出排序后的安全相对路径，以经过校验的 Runtime config fields `artifactDiagnosticMaxEntries` 与 `artifactDiagnosticMaxBytes` 为界，报告被省略的 entries，并且绝不跟随 symlink。继承 run 的 diagnostic 改为要求模型在 child 中重新运行，因为该 provenance 没有 child 自己拥有的 artifact directory。

Runtime 从持久 `runDirectoryRef` 与准确 Session scratch owner 重新推导 source run directory，在同一 Session 的 Host restart 后仍可工作，并在 publication 完成前持有现有 non-queuing exact-Session lease。最多读取 `ctx.attachments.imageLimits.maxImageBytes + 1` 字节只是内存守卫；`ctx.attachments.saveImage` 仍是 configured byte、pixel、decoded-media 与 `mediaTypes` admission rules 的唯一权威。Runtime 传入声明的 `image/png`；部署的 allowlist 若排除 PNG，则 `save_chart` 会在追加 event 前显式失败。随后，Runtime 再次检查 liveness、current projection、准确的 `startedSeq >= (header.seedLength ?? 0)` source predicate 与 authorizing facts，才追加 `science/chart-saved`。attachment persistence 先于 event；event 之前失败可以只留下未被引用的 content-addressed object，而已经提交的 event 不会因为之后 tool-result append 失败而回滚。

第一个 `logical_name` 获得新的 branded `ScienceChartId` 与 version `1`。之后保存同一 logical name 时保留 id，并把最新 version 增加一；不同 logical name 不得复用该 id。event 继承 source run 的 environment revision 与 fingerprint。`save_chart` 是 exclusive tool，使用 generic render intent 且没有 editor location：它的 artifact-relative path 不是客户端可打开的 workspace file。

一个共享的 direct-Science-mutation guard 覆盖这些生产端工具。`run_python`、`run_r`、`save_chart` 与 `publish_outcome` 在 Runtime lookup、filesystem work 或 append 之前拒绝 `exec.parent !== undefined`。这包含一项窄幅 R3 修复：nested Code Mode 发出的是 `tool/code-dispatch*`，不是四种 R1 transition 都要求的直接 `tool/call` provenance，而且 core tools 不会为 nested result 产生 `presentationMeta`。`get_science_state` 仍是可 nested 的只读调用。已交付 Science preset 保持 native，但显式 guard 能防止其他 composition 在产生 side effects 后才遇到较晚的 invariant failure。

canonical result 包含 model-safe chart receipt 与完整 attachment metadata。`output.render` 只输出文字。`output.presentationMeta` 为直接 top-level result 持久化 tagged、versioned Science chart presentation value；其中包含同一个 attachment reference 与 chart identity，绝不包含 bytes、base64、object URL 或 Host path。

`get_science_state` 通过 `stateChart` sanitizer 映射每个最近的 projection chart。其模型可见 entry 保留 chart id、logical name、version、title/caption、source run、environment revision、fingerprint preview、dimensions、byte count、media type 与 creation time；省略 `attachmentId`、完整 `environmentFingerprint`、`toolCallId` 与 `requestHeaderSeq`。完整 `ImageAttachmentRef` 只留在持久 projection 中，供 authorization 与 UI replay 使用，不进入模型 state。这与 `save_chart` 使用同一 text-receipt policy，不是第二份 chart history，也不是间接图片 handle。

### `publish_outcome`

这个直接 exclusive tool 的模型侧字段如下：

```ts
interface PublishOutcomeArgs {
  title: string
  summary_markdown: string
  evidence: Array<
    | { kind: 'run'; run_id: string }
    | { kind: 'chart'; chart_id: string; version: number }
    | { kind: 'message'; seq: number }
  >
}
```

执行时重放准确 live Science Session，要求最新 request header 与本次直接 `publish_outcome` tool call，规范化下一个连续 revision，并在 append 前通过所属 Science codecs 与 transition rules 校验 candidate。evidence 必须非空且唯一，只能命名先前 facts，只能引用成功 runs 与准确已保存 chart versions，并从 run 与 chart evidence 推导准确排序后的 environment-revision set。只含 message evidence 时，空 environment-revision list 合法。title、Markdown、evidence count、timestamps 与 identifiers 继续使用 R1 的持久上限。

`@deepseek-ai/dsh-tool-science` 在校验后直接追加 `science/outcome-published`。这种 Consumer 归属是有意的：publication 不执行 Host filesystem、attachment、subprocess 或 lease 操作，因此经由 `ScienceRuntimeService` 只会制造一项 Runtime 责任。`save_chart` 则继续由 Runtime 拥有，因为 attachment persistence、scratch authorization 与 liveness rechecks 必须共用 exact-Session lease。两种 append 都继续受现有严格 Science invariant 约束，candidate 被拒绝时都不追加内容。

成功 canonical result 包含完整 publication。模型 render 包含 revision、title、summary 与 evidence list，因此没有 Science UI 的 client 仍能得到有用结果，下一 model step 也能准确看到已发布内容；result 以模型自己的参数词汇回显 evidence。tagged、versioned presentation value 保留该准确 revision，使它在较新 Outcome 替换 projection current value 后仍可回放。Outcome 与 Goal 保持独立：publication 不读取或更改 Goal state，不结束 Goal，也不能引用 Goal id。

### Web chart 与 Outcome presentation

`packages/client/ui-science` 下的 `@deepseek-ai/dsh-client-ui-science` 为 `save_chart` 与 `publish_outcome` 注册 localized keyed `tool.call.toolview` rows。两个 row 都从 frozen call/result slice 推导 running、success、failure 与 interrupted states，只解析自身 tagged versioned presentation values；arguments 或 metadata 过旧、缺失或无效时退回 generic tool row。

chart row 展示 logical name、version、title、可选 caption、source run、dimensions 与 byte count，再通过 current Session-authorized image loader 加载持久 PNG，并复用 `ui-attachment` image/lightbox atoms。toolview owner share 携带经 `ToolCallTree` 传递的现有 conversation `loadImage` callback；这是通用 UI wiring，不是 Science 专用 byte loader 或第二个 URL cache。loading、missing/corrupt attachment、retry、original preview、intrinsic sizing、keyboard navigation、focus restoration 与 localized accessible names 都有 focused tests。

Outcome row 渲染 publication title 与 Markdown summary，标注 run/chart/message evidence，并展示从 `science` projection 解析出的 cited chart version thumbnails。它是只读 transcript occurrence，不是第二个 editor 或 sidebar。旧 Outcome row 使用自己的 presentation metadata；当前 chart lookup 来自持久 projection。projection 或 cited attachment 不可用时，文字 publication 与 evidence ids 仍保持可见，并明确报告 visual 缺失，不制造替代内容。

已交付 Web composition 挂载 `session-attachment-index`、Science Session Host plugin 与 `ui-science`；在 R5 阶段不增加 `science-runtime` row，R5 为每个 composition 都保留 R4 的部署归属。[R6](2026-08-17-dsh-science-v01-r6-settings-details.zh.md) 之后专门在已交付 Web bundle 中挂载带有意留空 profile map 的 settings-bound `@deepseek-ai/dsh-science-runtime/with-settings` row，因此具备实时能力的 Web 部署现在通过该 settings 卡片与一次 Host 重启命名其 `science` profile，而不再需要单独的 deployment overlay。base bundle 与没有 browser 的 CLI/headless composition 仍不增加 Runtime row，保留两个模型工具与文字 fallback，并保留现有首次使用时的 missing-service/profile diagnostic。准确 Science roster 是 R4 roster 加 `save_chart`、`publish_outcome`。Standard 与其他 preset 不会通过 process-global registration 获得任一工具或 Science UI behavior。

### Assembled scenarios 与文档

keyless assembled Science scenarios 使用真实 Loader、agent loop、Session store、Science Session fold、attachment store、已交付 preset 与 Web scaffold，并叠加一个显式 test overlay，挂载由 fake subprocess/sandbox providers 支撑的真实 Science Runtime。一次 run 在真实 owned artifact directory 写入 deterministic valid PNG；`save_chart` 提交 version 1，第二次保存证明连续 versioning，`publish_outcome` 引用该 run 与准确 chart version。snapshots 显示 text-only model results、脱敏后的 `get_science_state` chart entry、准确 durable event order、tagged client presentation，log 中没有 Host path 或 image bytes，没有 nested mutation，Standard 也没有 Science tools。message evidence 由 Consumer 的 unit suite 覆盖，而不是由 assembled transcript 覆盖。

可运行的源码 scenario `examples/headless-agent/science-tools.cordis.snapshot.yml` 在 Runtime 旁挂载 attachment store，因为 `save_chart` 先持久化字节再提交 event，Runtime 因此等待 `attachments`。其录制的 model view 逐字固定全部五个 Science 工具 schema 与 guidance section，其录制的 stream 固定 durable event order。chart identities 与 run identities 分别 tokenize，使被当作 run 引用的 chart 不会归一化成相同期望文本；environment-fingerprint preview 与它所预览的 fingerprint 一起归一化。

browser acceptance 使用包含有效 `science/chart-saved` 与 `science/outcome-published` events 的 deterministic stored Session/attachment fixture 加载真实已交付 Web composition；它验收 replay，不声称 base Web bundle 创建了图表。该验收通过 session-authorized attachment route 渲染 chart 与 Outcome，覆盖 reload/history replay 与旧 Outcome occurrence，检查 accessibility output 与 keyboard behavior，并证明 missing 或 corrupt object 会显式失败。Session export acceptance 解析 raw Session artifact，证明被引用 PNG 在 ZIP 中只出现一次，拒绝 foreign 或 forged reference，并在已知 extractor-required event 缺少 owner 时使整个 export 失败。

文档更新覆盖受影响的 package README/JSDoc pairs、`docs/subsystems/science.*`、拥有新 registry 的 Session subsystem 页面、capability-seam inventory，以及 generated package/config/tool/service-graph catalogs。易变 commands、SHAs、platforms 与 pass/fail results 只写入 dated R5 evidence triplet。

### 验证与收口

最终 candidate 上的 R5 证据包括受影响包的 unit suites、仓库 coverage gate、keyless source snapshot lane、含已交付 fixture chart/Outcome replay 的 Web browser lane、typecheck、lint、`doc-sync`、除既有 `rescope-vendor:check` 失败之外的全部 hygiene 子检查、whitespace 与 scope 检查，以及与 R4 基线对比的 cross-file duplication。R5 同时修复了 R4 记录过的既有 `knip` 失败：`examples/headless-agent` 的两个 Science fixtures 现在被声明为 examples workspace 的 entries。

真实 Python 与 R Runtime acceptance 从准确 candidate 的 clean archive 运行，使用受支持的 Node、私有非 `/tmp` `DSH_HOME` 与明确授权的现有 Conda prefixes。两种语言分别在其收到的 `SCIENCE_ARTIFACT_DIR` 下创建真实 PNG，并通过 run、chart commit、attachment readback、chart replay 与 Outcome publication，prefix manifest 保持不变。该证据不认证 provider credentials、Desktop、signing 或 release，它们保持 `NOT-RUN`。

### Supersession 与 lifecycle

R5 不 supersede 任何 active Agent Note。R1-R4 保持 active，因为它们的持久语义、Runtime 归属、Consumer rules 与已交付 preset constraints 继续约束 Science line。[durable attachment](2026-07-22-web-multimodal-image-input-and-durable-attachments.zh.md)、[minimal `read_image`](2026-08-10-minimal-read-image-tool.zh.md)、[tool presentation](../architecture/2026-08-08-client-tool-presentation-ownership.zh.md)、[Session projection](../../proposed/architecture/2026-07-27-session-projection-and-command-log.zh.md) 与 [Session export](2026-08-10-web-session-log-export.zh.md) 决策也继续独立有用；R5 消费它们，但不替代其 rationale。proposed [Task Surface](../../proposed/feature/2026-08-04-task-surface.zh.md) 明确排除 charts，与本决策无关。

没有 implemented note 符合 archive 条件，没有 proposal 被 supersede 或 reject，也没有 rejected guardrail 失效。

## Alternatives considered

**让 `save_chart` 返回 PNG `ImageBlock`。** 拒绝，因为该 block 会成为模型可见 tool-result history。已交付默认 DeepSeek route 明确拒绝 image input，因此一次成功保存之后的下一 step 会失败。R5 改为向模型返回文字 receipt，并向产品 UI 提供持久附件；`read_image` 继续是明确支持图片的模型路径。

**只授权复制到 `tool/result.meta` 的 attachment reference。** 拒绝，因为 Science event 先于 tool result 提交，并且在 crash 后必须独立充分。该方案还会让 Session ZIP export 依赖可选 presentation data，而不是拥有图表的 domain fact。

**让 ApiProxy import 并 special-case Science events。** 拒绝，因为通用 Host package 不应枚举产品领域。由 effect 管理的 Session attachment-reference registry 让 Science 自己校验 event，同时保留一个 domain-neutral authorization/export consumer。

**通过查询已注册的 Science projection 来授权和导出 charts。** 拒绝，因为 Session export 解析 raw stored artifact，未必存在 live projection，而 forked 或 cold Session 必须从自己的准确 log 授权继承的持久 chart references。projection 是可选的 current-state cache，不是 attachment-bearing events 的通用或完整权威。event extractor registry 针对 raw log 工作，同时服务 live reads 与 export。

**把 chart bytes 或 base64 写入 `science/chart-saved`。** 拒绝，因为这会在 logs、projections、forks、queries 与 exports 中复制不可变 media。`ImageAttachmentRef` 加 content-addressed attachment store 已经提供 integrity 与 replay。

**让 `save_chart` 读取任意 workspace path。** 拒绝，因为 chart producer 是 confined Science run，不是通用 filesystem write tool。只允许从成功 run 的私有 `SCIENCE_ARTIFACT_DIR` 导入，可以保留 run provenance，也不会把 Science Consumer 变成第二个 filesystem authority。

**允许 child fork 从 inherited run 的 artifact path 保存图表。** 拒绝，因为 private scratch 由准确 Session identity 拥有，而 durable run reference 刻意不包含 Host 或 ancestor path。child 可以在 Outcome 中引用继承的 durable runs 与 charts，但导入新 artifact 前必须在本 Session 重新运行代码。

**在 R5 增加 Science sidebar 或 current-result dashboard。** 拒绝，因为 R0 inventory 把 navigation 与 current-state product placement 交给 `SCI-SETTINGS-SIDEBAR`。R5 只在 transcript 中渲染 durable tool occurrences 与 cited visuals。

**在 base 或 Web bundle 挂载默认 Science Runtime row。** 对 R5 而言拒绝，因为 R2 要求显式且非空的既有 Host Conda prefixes allowlist，而 R5 既不发现也不管理这些路径。已交付 Web bundle 增加 projection、attachment-index 与 UI consumers；实时创建继续要求 deployment overlay，replay acceptance 使用 stored fixture，不暗示存在默认 Runtime。[R6](2026-08-17-dsh-science-v01-r6-settings-details.zh.md) 之后仅对 Web bundle 修正了这一点：它在那里挂载一个 settings-bound Runtime row，但该 row 的 profile map 有意留空，依然不发现也不管理任何 Conda prefix——这正是本条 alternative 所保留的非空 allowlist 要求，只是现在通过一次显式 settings 写入与 Host 重启来满足，而不再需要单独的 deployment overlay。

**采用通用 chart specification 或 plotting dependency。** 拒绝，因为 Python/R code 已经创建输出，attachment service 负责校验 raster bytes。R5 拥有 publication、provenance 与 presentation，而不是 plotting grammar 或 environment package manager。

## Consequences

Science preset 准确暴露五个 Science tools——`get_science_state`、`run_python`、`run_r`、`save_chart`、`publish_outcome`——其他 preset 都不暴露两个新工具。已交付 base bundle 不增加 Runtime row，保留 R4 的显式 missing-service/profile behavior；自 [R6](2026-08-17-dsh-science-v01-r6-settings-details.zh.md) 起，已交付 Web bundle 挂载一个 settings-bound、有意未配置的 Runtime row，而 CLI/headless bundles 仍不增加任何 row 并保留 R4 的行为，因此其余具备实时能力的验收仍会挂载明确的 deployment 或 test overlay。没有 attachment store 的部署现在会让 Science Runtime 停在等待 `attachments` 的状态，这与缺少 `science` profile 是同一种显式失败姿态，并可在 Loader diagnostics 中看到。

`save_chart` 只从 `science/run-started` sequence 满足 `startedSeq >= (session.header.seedLength ?? 0)` 的成功 run 导入 PNG，因此规则在同一 Session restart 后仍成立，并拒绝 inherited-run scratch。它先持久化 bytes 再提交 chart event，不发布 Host path，保持 logical versions 连续，保留 environment provenance，且不返回模型可见 image block。`ctx.attachments.saveImage` 仍是唯一 image-admission authority。`publish_outcome` 追加一个连续 revision，携带非空唯一的先前有效 evidence set 与准确推导的 environment-revision list，并与 Runtime 和 Goal 保持独立。registry 是 authorized reads 与 export 使用的唯一 event-to-attachment scanner，一个已提交的 `science/chart-saved` event 本身足以授权其准确 attachment。

先保存 attachment bytes 再提交 chart event，可能在 liveness、cancellation 或 event commit 失败时留下未引用的 content-addressed object。R5 接受这个有界 orphan，因为先发布 event 再持久化 bytes 会破坏 replay，而 reference-aware garbage collection 仍是独立 storage policy。保留的 Science run scratch 与 attachment objects 会继续占用磁盘；R5 不增加自动 cleanup，因为 resumed Session、forked durable chart 或 exported log 仍可能需要它们，quota policy 需要单独设计。

缺少 owner 时的显式失败可能使旧 Session 在不完整 deployment 中暂时无法读取或导出；这仍优于成功生成不完整 ZIP 或错误返回 unauthorized。过度宽松的 extractor 可能授权非预期引用，因此 registration 由 effect 管理、限定 event type、严格校验，并有 cross-Session negative tests；禁止任意 recursive JSON scanning，同一 event type 上的两个 live registrant 会被拒绝而不是引用计数。

Outcome Markdown 与 chart captions 是模型生成的持久 prose。现有 codec bounds 限制 log 与 DOM cost，但误导性标题或摘要仍可能出现，不能把它们转化成可信 scientific claims。evidence links 只证明引用了哪些先前 facts，不证明推理在科学上正确。真实 Python/R acceptance 证明 interpreter-to-artifact integration，不证明每个用户环境都具备 plotting library：R5 不安装 packages，也不选择 Conda prefix。

R5 以一条有序序列落地，而不是三个分别验收的检查点 head，因此规划中交给独立验收的风险控制，现在依赖最终合并 candidate 的 gates 与 evidence 中记录的有序 range review。R5 收口只改变 `SCI-CHARTS-OUTCOME`；settings/sidebar、Desktop、real-provider、publication、tag、push 与 release 仍在验收声明之外，与 R0-R4 overlay inventory 记录一致。
