# @deepseek-ai/dsh-tool-science

[English](README.md) | 中文

**面向模型的 Science mode Consumer**：首次使用时的 mode/environment 绑定、`science:environment` 动态上下文，以及五个工具：`get_science_state`、`run_python`、`run_r`、`save_chart` 与 `publish_outcome`。[`dsh-science-session`](../science-session) 拥有 durable vocabulary、严格 fold、projection 与 invariant；[`dsh-science-runtime`](../science-runtime) 拥有 environment 观测、私有 scratch、直接执行、终态分类与 chart 附件导入。本包从不 spawn 进程、写入 run source、分类终止方式或管理 Conda。Outcome 发布不需要 Host operation，因此本包在 durable evidence 校验后直接追加 `science/outcome-published`；其余 environment、run 与 chart fact 由 Runtime 追加。

一个组合按以下顺序叠加：`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-science-session` 及其 `/invariant`、一个 host-local 的 subprocess 与 sandbox provider、`@deepseek-ai/dsh-science-runtime`（以 `dshHome` 与 `profiles` 配置）及其 `/invariant`，然后是本包（以 `profileId`、`modeRevision` 与 `stateHistoryLimit` 配置）及其自身的 `/invariant`。

`ctx.scienceRuntime` 相对于本包自身的 `inject` 而言是可选的——它静态注入的只有 `tools` 与 `systemPrompt`，并在最早需要它的操作（首次使用绑定、每次 `run_python`/`run_r` 调用及 `save_chart`）时才读取 `ctx.get('scienceRuntime')`。即使部署省略 Runtime，本包仍会正常加载；此时对 `science`-preset session 的 assembly 会以清晰错误拒绝，而不是悄悄降级。`publish_outcome` 可对已经持久化的证据工作，不需要 Runtime access。

## 配置

三个键都是必填项，均没有默认值或从环境发现的值。本包不提供已发布的生产身份或历史返回策略。

| 键 | 含义 |
|---|---|
| `profileId` | 从已组合的 `ctx.scienceRuntime` 的 `profiles` 配置中选择一个 allowlist 条目。会按持久化 Science safe-ID grammar 校验（`^[A-Za-z0-9][A-Za-z0-9._-]*$`，≤128 个字符）。 |
| `modeRevision` | 部署方拥有的 Science mode contract revision，会持久化在每个 session 的 `ScienceModeRef` 中。要求 trim 后非空且 ≤128 个字符。 |
| `stateHistoryLimit` | 正 safe integer；每次 `get_science_state` 调用分别最多返回这么多条最近 run 与 chart version。 |

## 首次模型请求

对于 session `header.agentPreset === 'science'` 的 Agent，在其首次真正的 Science prompt assembly 时，本包会重放该 session。如果不存在 `science/mode-bound`，本包会在任何 `step/start`、`request/header` 或 `tool/call` 之前追加一条——durable 的 Science Session applicability 规则会独立强制这一顺序。已存在 mode 的 revision 必须等于配置的 `modeRevision`；不匹配会在构造请求之前拒绝 assembly。如果不存在 durable environment，本包会调用 `ctx.scienceRuntime.bindEnvironment({ session, profileId, signal })`；无论结果是 durable 的 applied 值还是 `invalid` 值，都是模型可见的值，而 Runtime 缺失、取消、超时、Host I/O 失败或 confinement 失败则会改为拒绝 assembly。已匹配的已恢复 session 不会触发自动重新绑定——仅靠重放即可确认两项事实均已成立。没有发起 Agent 的诊断性 prompt assembly，或非 `science`-preset 的 session，不会执行任何 Host I/O，也永远不会追加 Science 事件。

绑定完成后，本包会根据刚提交的 projection 重新渲染 `science:environment` 上下文，并在正在进行的 assembly 中替换那一个具名条目，然后精确地委托一次给 `system-prompt/assemble` waterfall。随后 agent loop 会在 `request/header` 之前把该当前上下文记录为一条 `user/message`，因此首次请求——以及同一步骤内的每次重试请求——都始终可以从 session 日志重建。

## 工具

| 工具 | 参数 | 行为 |
|---|---|---|
| `get_science_state` | 无 | 返回该 session durable Science projection 的 sanitized、bounded view：mode、model-safe environment facts、最近的 run 与 chart-version 历史、遗漏计数、outcome 与总量 metrics。如果 Science mode 尚未绑定则拒绝。 |
| `run_python` | `code`（非空字符串） | 通过 `ctx.scienceRuntime.startRun` 在一个全新的 Python 解释器进程中运行 `code`，并转发该工具调用的取消信号。 |
| `run_r` | `code`（非空字符串） | 通过 `ctx.scienceRuntime.startRun` 在一个全新的 `Rscript` 进程中运行 `code`，并转发该工具调用的取消信号。 |
| `save_chart` | `run_id`、`artifact_path`、`logical_name`、`title`、可选 `caption` | 通过 `ctx.scienceRuntime.commitChart` 导入先前成功本地 run 生成的一张 PNG；返回文本 receipt 与客户端展示元数据，绝不返回 image block。 |
| `publish_outcome` | `title`、`summary_markdown`、非空 `evidence` | 解析唯一的先前 run/chart/message 引用并派生其 environment revision 后，追加下一条连续 Outcome revision。 |

四个 mutation 工具都要求 direct 顶层 dispatch、最新 `request/header` 与确切 tool-call ID；嵌套 Code Mode dispatch 会在 Runtime lookup 或 Session mutation 之前拒绝。Durable run 终态是包含受限 output 的结构化 canonical 值。Chart 与 Outcome success 值为所有客户端渲染有用文本，并为专用 Web 行保留带标签、带版本的 presentation metadata。五个工具都使用 generic render intent，不带 editor location。

## 模型体验

### 静态工具指引

#### 模型看到的内容

本包贡献一段固定的静态区段，描述 run 工具的进程模型、状态持久化规则，以及失败与错误的区分，原文照录如下。

##### Science 工具指引

```markdown
Use run_python or run_r to execute source in the session's bound Science environment. Each call starts a fresh interpreter process; no in-memory state survives between calls. Store anything that must survive between calls under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR. A terminal program failure (non-zero exit, exception, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction. A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed. Use get_science_state to read the current mode, environment, and run history without starting a process. After a successful run writes a PNG under SCIENCE_ARTIFACT_DIR, use save_chart to durably save it; the tool returns a text receipt, never image bytes, and the chart becomes visible in the product transcript. Use publish_outcome to publish the current result as a titled, cited Outcome revision once evidence (successful runs, saved chart versions, and/or prior messages) supports it.
```

#### Token 影响

只要插件处于活动状态，每次请求都有固定的指引开销。

#### KV Cache 影响

只要指引文本不变，就是 prefix-stable 的；插件生命周期变化可能使这一区段失去复用资格。

### `science:environment` 动态上下文

#### 模型看到的内容

对于 `science`-preset 的 session：当前 mode revision；已绑定 environment 的 profile、revision 与 status；每个已配置解释器的 capability，以及可用时的 version 与一段截断后的 fingerprint；存在时最近一次 run 的 id、语言与 status；以及固定的 `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR` 状态规则。它不包含 Runtime-owned free-text reason、source、stdout、stderr、凭据或 Host path/identity field。在 Science mode 之外，或对于没有发起 Agent 的诊断性 assembly，它会渲染为 `''`，不贡献任何内容。

#### Token 影响

有界：一行 mode、一行 environment、至多两行解释器信息，以及一行最近 run 信息。在两次请求之间未变化时不会新增任何 token；environment 变化或出现新 run 时会替换整个快照。

#### KV Cache 影响

只要渲染出的快照未变化就是 append-only 的：[`dsh-agent-loop`](../../core/agent-loop) 只有在上下文确实发生变化、被压缩移除，或某次重试请求需要恢复它时，才会追加一份新的 `user/message` 副本——而不是每一步都追加。变化后的快照会使复用从第一个变化的 token 起失效，这与其他任何动态 runtime 上下文一致。

### 工具 schema

#### 模型看到的内容

模型会看到生成的 [`get_science_state`、`run_python`、`run_r`、`save_chart` 与 `publish_outcome` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-science)。只要组合了本包，这些 schema 就会无条件注册；内置 `science` agent preset（`apps/cli/config/agent-presets/science`）正是完成该组合的随附组装。

#### Token 影响

在该插件的注册 scope 内，每次请求都有固定的 schema 开销。

#### KV Cache 影响

只要可见的工具定义与顺序未变化就是 prefix-stable 的。插件生命周期变化可能使复用从第一个变化的 schema token 起失效。

### Run 结果

#### 模型看到的内容

一次 durable 提交的 run 会渲染为 `status: <status>`，可能附带 ` exit <code>` 和/或 ` signal <signal>` 后缀，随后在存在时给出 `failureCode`/`failureMessage` 行，再给出 `--- stdout ---`/`--- stderr ---` 两个区段，分别展示捕获到的文本或 `(empty)`；当达到 Runtime 的捕获上限时，会附带一行 `(stdout truncated)`/`(stderr truncated)`。非 success 的 status 是需要阅读的一等结果，而不是一个错误。

#### Token 影响

受 Runtime 的 stdout/stderr 捕获上限约束；保留的调用与结果会在压缩之前被重复发送。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

### Science 状态结果

#### 模型看到的内容

`get_science_state` 会把 replay projection 的 sanitized、bounded view 渲染为 JSON：`mode`；model-safe 的 `environment` identity、status、capability、version 与 fingerprint preview；去掉携带 path 的 Runtime-owned free text 后的最近 `runs`；最近的 `charts`；`outcome`；总量 `metrics`；`history.runsOmitted` 与 `history.chartVersionsOmitted`；以及 `lastScienceEventSeq`。它绝不返回 configured/canonical prefix、executable path 或 identity、Conda history hash、Runtime-owned free-text reason、凭据、source、stdout 或 stderr。Chart title/caption 与 Outcome text 仍属于 model-authored durable content，而不是 Host observation field。

#### Token 影响

Run item 与 chart-version item 会分别限制为最近 `stateHistoryLimit` 条；durable codec 还会限制每一条 retained item。`metrics` 与 `history` 会报告总量和遗漏数，但不会返回被遗漏的值。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

### Chart 与 Outcome 结果

#### 模型看到的内容

`save_chart` 以文本渲染稳定 chart id、逻辑名、版本、标题、可选 caption、来源 run、PNG 尺寸、字节数与创建时间；绝不输出 image bytes 或 image content block。`publish_outcome` 渲染 revision、标题、Markdown 摘要，以及每条 run/chart/message evidence reference。带标签的客户端 presentation value 留在 durable tool-result metadata 中，不会增加独立模型内容。

#### Token 影响

受 chart receipt field 以及 durable Outcome 标题、摘要与 evidence 上限约束；保留的调用/结果会在 compaction 前重复发送。

#### KV Cache 影响

Append-only；新出现的结果文本位于可复用 request prefix 之后。

### 工具错误

#### 模型看到的内容

配置与前置条件失败会被规范化为 `Error: <message>`。它会区分 initiating Agent/preset/mode/request header/Runtime 缺失、空 source 或 publication field、嵌套 mutation dispatch、不成功或继承的 chart source run、artifact selection/admission 失败，以及无效或重复 Outcome evidence。

#### Token 影响

只有失败的调用才会新增这些保留 token。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

## 已知限制与暂缓事项

- **不拥有组装，无默认 Runtime** — 本包不自行组合任何 preset、CLI/Web profile 行或 Runtime 配置；随附 `apps/cli` 的内置 `science` agent preset（`apps/cli/config/agent-presets/science`）是独立的应用层组装，`ctx.scienceRuntime` 仍是每个 Host 各自挂载的显式部署配置。参见 [R3](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md) 与 [R4](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md) Agent Note。
- **没有 chart specification 或 Outcome editor** — 模型在 Python/R 中生成 PNG，并发布不可变、evidence-backed 的 Outcome revision；本包不提供 plotting grammar 或可变 report document。
- **没有持久化 kernel** — 每次 `run_python`/`run_r` 调用都是一个全新的解释器进程；只有 `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR` 中的文件会跨调用持久化。
- **自动捕获的非图片 artifact 已持久化写入日志，但本包尚未使其对模型可见** — `dsh-science-runtime` 现在会把 run 写出的每个合格 csv/json/md/png/txt 文件自动捕获为带版本的 `science/artifact-saved` 事实(不再局限于通过 `save_chart` 保存的 PNG)，但 `get_science_state` 的 `charts` 字段与 `run_python`/`run_r` 的结果文本目前分别仍只覆盖 PNG、且不带捕获回执，直到后续改动将二者分别泛化(`charts` 覆盖每种被捕获的媒体类型，并在 run 结果中追加捕获回执)。
