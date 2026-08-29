# @deepseek-ai/dsh-tool-science

[English](README.md) | 中文

**面向模型的 Science mode Consumer**：首次使用时的 mode/environment 绑定、`science:environment` 动态上下文，以及五个工具：`get_science_state`、`run_python`、`run_r`、`annotate_artifact` 与 `publish_outcome`。[`dsh-science-session`](../science-session) 拥有 durable vocabulary、严格 fold、projection 与 invariant；[`dsh-science-runtime`](../science-runtime) 拥有 environment 观测、私有 scratch、直接执行、终态分类、run 写出文件的自动捕获，以及纯元数据的 artifact 策展。本包从不 spawn 进程、写入 run source、分类终止方式或管理 Conda。Outcome 发布不需要 Host operation，因此本包在 durable evidence 校验后直接追加 `science/outcome-published`；其余 environment、run 与 artifact fact 由 Runtime 追加。

一个组合按以下顺序叠加：`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-science-session` 及其 `/invariant`、`@deepseek-ai/dsh-science-artifact-store`、一个 host-local 的 subprocess 与 sandbox provider、`@deepseek-ai/dsh-science-runtime`（以 `dshHome` 与 `profiles` 配置）及其 `/invariant`，然后是本包（以 `profileId`、`modeRevision` 与 `stateHistoryLimit` 配置）及其自身的 `/invariant`。

本包还拥有 artifact viewer 使用的 `scienceEdits` Typert Remote。Web Host 在 Typert Gateway 解析 Remote service 的 Host root 挂载其 `./edit-service` 入口；preset scope 下的包根入口仍是面向模型的 Consumer，不发布 service。该入口注入 `attachments`、`scienceArtifactStore` 与 `scienceRuntime`，从而准入确切已提交 PNG 与直接图表操作。`submit` 接受一个非空有序的 `ScienceEditTarget` 数组（一个 normalized raster region，或一个按 id 指名某个可寻址图表元素的 `ScienceElementTarget`）和一条指令。每个 target 可以携带一条元素备注，并使用与指令相同的文本规则校验和去除首尾空白。它严格 fold 被寻址在线 Agent 的完整 session，在排入一条结构化用户消息前校验每个 target 的当前已提交版本；region target 还额外要求 raster 媒体类型，元素 target 则不带独立的媒体约束。任一失败会标明 target 位置，并阻止部分准入。同一版本上的重复 region target 会复用一张已铸造图像；元素 target 既不读 store 也不铸造图像。陈旧选择以 `SCIENCE_EDIT_STALE_VERSION` 拒绝，region 媒体类型不匹配以 `SCIENCE_EDIT_TARGET_MISMATCH` 拒绝；该方法绝不静默替换成最新版本。消息 source 保存 `{ kind: 'science-edit', targets, instruction }`，文本要求模型在相应 `artifact_inputs` 与 `edit_of` 中使用每个确切版本；每个选中的 raster version 都按 target 顺序附加其已铸造图像，每个元素 target 则渲染为一段不带图像的结构化 `element(id, kind=..., current=...)` 描述。

`scienceEdits.applyChartOps` 把确切的 `{ artifactId, version, ops }` 请求与取消信号转发给 `ctx.scienceRuntime.applyChartEdit`。receipt 会命名已提交的 `origin: 'human-edit'` version 与任何带索引的部分失败。它把陈旧、不可寻址以及无效或全部无法解析的操作分别映射为 `CHART_STALE`、`CHART_NOT_ADDRESSABLE` 与 `CHART_OP_INVALID`；Runtime 仍是唯一校验者。面向模型的 state 与 artifact receipt 以 `editCount` 加操作名称/元素 target pair 概括累计直接编辑，并省略所有操作值。

`ctx.scienceRuntime` 相对于本包自身的 `inject` 而言是可选的——它静态注入的只有 `tools` 与 `systemPrompt`，并在最早需要它的操作（首次使用绑定、每次 `run_python`/`run_r` 调用及 `annotate_artifact`）时才读取 `ctx.get('scienceRuntime')`。即使部署省略 Runtime，本包仍会正常加载；此时对 `science`-preset session 的 assembly 会以清晰错误拒绝，而不是悄悄降级。`publish_outcome` 可对已经持久化的证据工作，不需要 Runtime access。

## 配置

三个键都是必填项，均没有默认值或从环境发现的值。本包不提供已发布的生产身份或历史返回策略。

| 键 | 含义 |
|---|---|
| `profileId` | 从已组合的 `ctx.scienceRuntime` 的 `profiles` 配置中选择一个 allowlist 条目。会按持久化 Science safe-ID grammar 校验（`^[A-Za-z0-9][A-Za-z0-9._-]*$`，≤128 个字符）。 |
| `modeRevision` | 部署方拥有的 Science mode contract revision，会持久化在每个 session 的 `ScienceModeRef` 中。要求 trim 后非空且 ≤128 个字符。 |
| `stateHistoryLimit` | 正 safe integer；每次 `get_science_state` 调用分别最多返回这么多条最近 run 与 artifact version。 |

## 首次模型请求

对于 session 当前解析结果为 `science` preset 的 Agent（`@deepseek-ai/dsh-agent-presets` 的 `resolveSessionPreset`：以 session 的创建 header 为基础，被最后一条 `agent-preset/selected` 事件覆盖——一个在 blank 状态下切换到 `science` 的 session 即使其 header 仍记录创建时的 preset，也满足条件），在其首次真正的 Science prompt assembly 时，本包会重放该 session。如果不存在 `science/mode-bound`，本包会在任何 `step/start`、`request/header` 或 `tool/call` 之前追加一条——durable 的 Science Session applicability 规则会独立强制这一顺序。已存在 mode 的 revision 必须等于配置的 `modeRevision`；不匹配会在构造请求之前拒绝 assembly。如果不存在 durable environment，本包会调用 `ctx.scienceRuntime.bindEnvironment({ session, profileId, signal })`；无论结果是 durable 的 applied 值还是 `invalid` 值，都是模型可见的值，而 Runtime 缺失、取消、超时、Host I/O 失败或 confinement 失败则会改为拒绝 assembly。已匹配的已恢复 session 不会触发自动重新绑定——仅靠重放即可确认两项事实均已成立。没有发起 Agent 的诊断性 prompt assembly，或非 `science`-preset 的 session，不会执行任何 Host I/O，也永远不会追加 Science 事件。

绑定完成后，本包会根据刚提交的 projection 重新渲染 `science:environment` 上下文，并在正在进行的 assembly 中替换那一个具名条目，然后精确地委托一次给 `system-prompt/assemble` waterfall。随后 agent loop 会在 `request/header` 之前把该当前上下文记录为一条 `user/message`，因此首次请求——以及同一步骤内的每次重试请求——都始终可以从 session 日志重建。

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `get_science_state` | 无 | 返回该 session durable Science projection 的 sanitized、bounded view：mode、model-safe environment facts、最近的 run 与 artifact-version 历史、遗漏计数、outcome 与总量 metrics。如果 Science mode 尚未绑定则拒绝。 |
| `run_python` | `code`（非空字符串）、可选 `artifact_inputs`、可选 `edit_of`、可选 `raster_artifacts` | 通过 `ctx.scienceRuntime.startRun` 在该 session 持久化的 Python kernel 中运行 `code`，并转发该工具调用的取消信号。`artifact_inputs` 把精确的 `{artifactId, version}` 物化到 `SCIENCE_INPUT_DIR` 下的路径；`edit_of` 把捕获相对输出路径映射到精确父版本；`raster_artifacts` 指名这次 run 在 Runtime 默认的 `rasterCapture: 'declared'` 策略下声明要自动捕获的捕获相对 `.png` 路径。以 `fig.savefig()` 或 `plt.savefig()` 保存的已声明 PNG 会在抽取成功时保留可寻址的 matplotlib 图表状态。其结果会列出本次 run 被自动捕获并持久保存的文件，以及未声明而被跳过的 `.png`（见"Run 结果"）。 |
| `run_r` | `code`（非空字符串）、可选 `artifact_inputs`、可选 `edit_of`、可选 `raster_artifacts` | 对该 session 的持久化 R kernel 应用相同的精确版本 input、edit parent 与 raster 声明行为。以 `ggsave()` 保存的已声明 PNG 会在抽取成功时保留可寻址的 ggplot2 图表状态。 |
| `annotate_artifact` | `logical_name`、可选 `version`、`title`、可选 `caption` | 为 `dsh-science-runtime` 自动捕获已经持久保存的某个 artifact 添加标题/caption，通过 `ctx.scienceRuntime.annotateArtifact`；纯元数据操作，因此它为所命名的版本重新加标题，而不会提交一个字节与其前身完全相同的新版本。返回文本 receipt，绝不返回文件字节。 |
| `publish_outcome` | `title`、`summary_markdown`、非空 `evidence` | 解析唯一的先前 run/artifact/message 引用并派生其 environment revision 后，追加下一条连续 Outcome revision。 |

四个 mutation 工具都要求 direct 顶层 dispatch、最新 `request/header` 与确切 tool-call ID；嵌套 Code Mode dispatch 会在 Runtime lookup 或 Session mutation 之前拒绝。Durable run 终态是包含受限 output 的结构化 canonical 值。Artifact 与 Outcome success 值为所有客户端渲染有用文本；`run_python`/`run_r` 与 `annotate_artifact` 还会为每一个被捕获或被策展的 artifact（任意受支持媒体类型）额外保留一条带标签、带版本的 presentation 值，供专用 Web 行使用。五个工具都使用 generic render intent，不带 editor location。

## 模型体验

### 静态工具指引

#### 模型看到的内容

本包贡献一段固定的静态区段，描述 run 工具的进程模型、状态持久化规则，以及失败与错误的区分，原文照录如下；`run_python`/`run_r` 各自的工具描述也用各语言自己的措辞携带同一条持久化规则——重启原因、指向"Run 结果"一节中同一 kernel fact 的"下次 run 结果会说明"提示，以及 inline install 与 environment install 的区分（`pip install`/`install.packages()` 与 kernel 同生共死；安装进 environment 则是桌面 provisioning 那条工作线拥有的、更长生命周期的独立操作）。

##### Science 工具指引

```markdown
Use run_python or run_r to execute source in the session's bound Science environment. Each language has one persistent kernel per session: variables, imports, and definitions stay in memory across calls to that language's run tool until the kernel restarts (idle timeout, environment re-bind, interrupt escalation, crash, or session end). A run result names the reason right after a restart. Store anything that must survive a kernel restart under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR; artifact_inputs materialize under SCIENCE_INPUT_DIR. When modifying or regenerating an existing artifact, reference its exact version through edit_of for a direct edit or artifact_inputs for an input, and write the output to the same relative path under SCIENCE_ARTIFACT_DIR so automatic capture appends the existing version chain. A terminal program failure (exception, error condition, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction. A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed. Use get_science_state to read the current mode, environment, kernel state, and run history without starting a run. Make charts with matplotlib (Python) or ggplot2 (R), save each one as a PNG under SCIENCE_ARTIFACT_DIR, and name it in raster_artifacts so it is captured. Do not use Altair or Vega-Lite. Save matplotlib figures with fig.savefig()/plt.savefig() and ggplot2 charts with ggsave(); figures saved that way stay addressable for direct edits in the viewer. A run's eligible written files (csv/json/md/txt under SCIENCE_ARTIFACT_DIR) are durably captured automatically as versioned artifacts, and a PNG only when named in raster_artifacts; no separate save step is needed otherwise. Use annotate_artifact to give the artifact that best demonstrates your result a human-readable title and optional caption, so it is highlighted for the reader. Write a render, preview, or debug dump meant only for your own inspection outside SCIENCE_ARTIFACT_DIR (for example a temp directory), never into it, so it is never captured as an artifact. Do not open a new artifact version to reconcile a cosmetic difference the user did not ask for; mention the difference in your reply instead. Use publish_outcome to publish the current result as a titled, cited Outcome revision once evidence (successful runs, saved artifact versions, and/or prior messages) supports it.
```

#### Token 影响

只要插件处于活动状态，每次请求都有固定的指引开销；相对此前"一次性进程"措辞，本区段与两个 run 工具描述因持久化规则的句子而变长——这是一次性的固定增量，不是按次 run 计费的开销。

#### KV Cache 影响

只要指引文本不变，就是 prefix-stable 的；插件生命周期变化可能使这一区段失去复用资格。

### `science:environment` 动态上下文

#### 模型看到的内容

对于 `science`-preset 的 session：当前 mode revision；已绑定 environment 的 profile、revision 与 status；每个已配置解释器的 capability，以及可用时的 version 与一段截断后的 fingerprint；存在时最近一次 run 的 id、语言与 status；以及固定的 kernel 持久化/重启规则（现在与静态指引使用同一套重启原因）加上 `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR`/`SCIENCE_INPUT_DIR` 的划分。它不包含 Runtime-owned free-text reason、source、stdout、stderr、凭据或 Host path/identity field；也——刻意地，为了让这个每轮都渲染的区块保持小而稳定——不包含当前 kernel 状态本身：这项内容留给 run 结果里的重启 fact，以及按需读取（而非每轮重发）的 `get_science_state` 的有界 `kernels` 列表。在 Science mode 之外，或对于没有发起 Agent 的诊断性 assembly，它会渲染为 `''`，不贡献任何内容。

#### Token 影响

有界：一行 mode、一行 environment、至多两行解释器信息，以及一行最近 run 信息。在两次请求之间未变化时不会新增任何 token；environment 变化或出现新 run 时会替换整个快照。

#### KV Cache 影响

只要渲染出的快照未变化就是 append-only 的：[`dsh-agent-loop`](../../core/agent-loop) 只有在上下文确实发生变化、被压缩移除，或某次重试请求需要恢复它时，才会追加一份新的 `user/message` 副本——而不是每一步都追加。变化后的快照会使复用从第一个变化的 token 起失效，这与其他任何动态 runtime 上下文一致。

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`get_science_state`、`run_python`、`run_r`、`annotate_artifact` 与 `publish_outcome` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-science)。只要组合了本包，这些 schema 就会无条件注册；内置 `science` agent preset（`apps/cli/config/agent-presets/science`）正是完成该组合的随附组装。

#### Token 影响

在该插件的注册 scope 内，每次请求都有固定的 schema 开销。

#### KV Cache 影响

只要可见的工具定义与顺序未变化就是 prefix-stable 的。插件生命周期变化可能使复用从第一个变化的 schema token 起失效。

### Viewer 编辑消息

#### 模型看到的内容

获准的 artifact viewer 编辑是一个普通用户轮次。其文本会列出一个非空有序 target 集合、每个 target 的逻辑 artifact 与确切版本及其可选元素备注、一条指令，以及必须把每个版本作为相应 `artifact_inputs` source 与 `edit_of` parent。持久化的 `science-edit` source 保存 `{ targets, instruction }`；每个 raster target 都按 target 顺序提供确切被选中的图像附件，元素 target 则不贡献图像。

#### Token 影响

上限由固定框架文本、已校验的 target 列表与指令，以及每个 raster target 的一份图像附件构成。消息会保留在请求历史中，直到上下文压缩（compaction）。

#### KV Cache 影响

仅追加；该消息与其他用户 follow-up 一样位于可复用请求前缀之后。

### Viewer Review 备注

#### 模型看到的内容

什么也看不到。`ScienceEditService.addArtifactNote` 与 `removeArtifactNote` 是用户侧 viewer 状态的专用 Host Remote。添加操作校验 session 内可见的确切 store `ScienceArtifactId` 与版本、裁剪纯文本，并以 `SCIENCE_EDIT_INVALID_REQUEST` 拒绝超过 8,192 字符的内容；删除操作要求活跃添加事件的序号确实属于该 artifact。两者只追加可忽略的非 surface 事件，不排入 agent follow-up。

#### Token 影响

无；Review 备注绝不进入模型请求。

#### KV Cache 影响

无；Review 备注变更不会改变模型可见前缀。

### Run 结果

#### 模型看到的内容

当这次 run 是其自身 kernel epoch 下、在该语言更早一个 epoch 之后记录的第一次 run 时，开头会有一行陈述这一事实：`kernel restarted (<reason>): variables from earlier runs are gone`，`<reason>` 取自 `idle timeout`、`environment re-bind`、`interrupt escalation`、`kernel crash`、`session end` 之一，或 `protocol`/`service-disposed` 两个内部故障措辞——这是 run 结果会陈述的唯一 kernel fact，且只在它有信息量时才出现（该语言的最初一个 epoch，以及之后每一次复用同一 kernel 的 run，这里都不会新增任何内容）。随后每次 run 都会渲染为 `status: <status>`，随后在存在时给出 `failureCode`/`failureMessage` 行，再给出 `--- stdout ---`/`--- stderr ---` 两个区段，分别展示捕获到的文本或 `(empty)`；当达到 Runtime 的捕获上限时，会附带一行 `(stdout truncated)`/`(stderr truncated)`。当捕获同步执行且产生了新版本时，还会附带一行清单，逐个列出产物的逻辑名、版本、稳定产物 id、媒体类型、可选尺寸与字节数：`` Captured 2 artifacts: `summary.csv` v1 (artifact-a; text/csv, 4.1 KB), `plots/loss.png` v4 (artifact-b; image/png, 812x600, edited from artifact-b v2). `` 带显式祖先关系的产物还会命名其精确父级 id 与版本。如果某条 `edit_of` 命名的输出路径这次 run 实际并未写出，或写出的字节与该 artifact 当前版本完全相同，这条 baseline 会被静默丢弃：capture 不会为该路径提交任何新版本，因此无论是这条回执还是 durable log 都不会记录所声明的 parent。在默认的 `rasterCapture: 'declared'` 策略下，这次 run 写出但未在 `raster_artifacts` 中声明的合格 `.png` 会附带一行指名它：`` (1 PNG file not captured, not declared in raster_artifacts: debug/preview.png) ``。跳过的超限文件数量与 per-run/per-session 截断标记若为真也会各自渲染为一行。非 success 的 run status 是需要阅读的一等结果，而不是错误；该回执完全从 run 自身受限的 output field 派生，因此不会偏离它所描述的 durable `science/artifact-saved`/`science/kernel-state` 事件。

#### Token 影响

受 Runtime 的 stdout/stderr 捕获上限，以及 `captureMaxFilesPerRun` 条被捕获 artifact 条目共同约束，外加极少数紧跟 kernel 重启之后的 run 会多出的一行短文本；保留的调用与结果会在压缩之前被重复发送。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

### Science 状态结果

#### 模型看到的内容

`get_science_state` 会把 replay projection 的 sanitized、bounded view 渲染为 JSON：`mode`；model-safe 的 `environment` identity、status、capability、version 与 fingerprint preview；去掉携带 path 的 Runtime-owned free text 后的最近 `runs`（每条各自携带自己的 `kernelEpoch`——这是"两次 run 共享同一 epoch 即共享同一 kernel 内存状态"这一 provenance fact）；最近的 `kernels`，各自带 `language`、`kernelEpoch`、`state`（`running`/`exited`/`interrupted`，对应 durable 的 `started`/`exited` 转换加上 replay 派生的中断态的模型词汇）、`reason`（仅在 `exited` 时出现，与 run 结果里的 kernel fact 使用同一套重启原因词汇）与 `startedAt`；最近的 `artifacts`（覆盖每种被捕获的媒体类型、带 run fact 的 run 产出 `origin: 'auto' | 'model'` 条目，以及带确切 `parent` 且没有 run-only provenance 的直接 `origin: 'human-edit'` PNG 条目；`width`/`height` 仍只在图片时出现）；`outcome`；`metrics`；`history.runsOmitted`、`history.kernelsOmitted` 与 `history.artifactVersionsOmitted`；以及 `lastScienceEventSeq`。它绝不返回 configured/canonical prefix、executable path 或 identity、Conda history hash、Runtime-owned free-text reason、凭据、source、stdout 或 stderr。Artifact title/caption 与 Outcome text 仍属于 model-authored 或 capture-authored 的 durable content，而不是 Host observation field。`metrics` 是对 durable projection 计数器的显式字段选择，而不是逐字透传——这是一个刻意决定：未来任何 Host 侧新增计数器都必须在这里被有意识地接入，才会到达模型。Durable 的 `kernelCount` 计数器被刻意不选入：`kernels`/`history.kernelsOmitted` 已经用模型词汇、逐 kernel、完整地陈述了同一事实；再保留一个冗余的原始计数只会白白花费 token 而不增加信息量，并且在 `stateHistoryLimit` 更小时可能与被截断的 `kernels` 列表读起来不一致。

#### Token 影响

Run、kernel 与 artifact-version item 会分别限制为最近 `stateHistoryLimit` 条；durable codec 还会限制每一条 retained item。`metrics` 与 `history` 会报告总量和遗漏数，但不会返回被遗漏的值。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

### Artifact 与 Outcome 结果

#### 模型看到的内容

`annotate_artifact` 以文本渲染稳定 artifact id、逻辑名、版本、标题、可选 caption、来源 run、媒体类型、策展版本为图片时的尺寸、字节数与创建时间；绝不输出文件字节或 image content block。`publish_outcome` 渲染 revision、标题、Markdown 摘要，以及每条 run/artifact/message evidence reference。两个工具（以及 `run_python`/`run_r`）带标签的客户端 presentation value 都不是模型可见内容——它随 `tool/result.meta` 传递，只由 `dsh-client-ui-science` 的专用行读取。

#### Token 影响

受 artifact receipt field 以及 durable Outcome 标题、摘要与 evidence 上限约束；保留的调用/结果会在 compaction 前重复发送。

#### KV Cache 影响

Append-only；新出现的结果文本位于可复用 request prefix 之后。

### 工具错误

#### 模型看到的内容

配置与前置条件失败会被规范化为 `Error: <message>`。它会区分 initiating Agent/preset/mode/request header/Runtime 缺失、空 source 或 publication field、嵌套 mutation dispatch、重复的 `edit_of` path、无法解析或无效的 artifact input/edit parent/raster artifact path、未知的 artifact `logical_name`/`version`，以及无效或重复的 Outcome evidence。

#### Token 影响

只有失败的调用才会新增这些保留 token。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

## 已知限制与暂缓事项

- **不拥有组装，无默认 Runtime** — 本包不自行组合任何 preset、CLI/Web profile 行或 Runtime 配置；随附的内置 `science` agent preset 与 Web Host 的 `./edit-service` 行是独立的应用层组装，`ctx.scienceRuntime` 仍是每个 Host 各自挂载的显式部署配置。参见 [R3](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.zh.md) 与 [R4](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.zh.md) Agent Note。
- **没有直接 chart editor 或 Outcome editor** — raster-region 选择会成为模型指令；chart 修改及不可变、evidence-backed 的 Outcome revision 均由模型负责。
