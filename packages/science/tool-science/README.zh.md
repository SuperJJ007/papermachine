# @deepseek-ai/dsh-tool-science

[English](README.md) | 中文

**面向模型的 Science mode Consumer**：首次使用时的 mode/environment 绑定、`science:environment` 动态上下文，以及 `get_science_state`、`run_python` 与 `run_r` 工具。这是 Science 能力 seam 的 Consumer 角色——[`dsh-science-session`](../science-session) 是它的 Service Definition（durable event、严格 fold、invariant），[`dsh-science-runtime`](../science-runtime) 是它的 Service Provider（`ctx.scienceRuntime`：environment 观测、私有 scratch、直接执行、终态分类）。本包从不 spawn 进程、写入 run source、分类终止方式、管理 Conda，或追加 Runtime 拥有的事件；它执行的每一项操作都通过 `ctx.scienceRuntime` 完成。

一个组合按以下顺序叠加：`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-system-prompt`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-science-session` 及其 `/invariant`、一个 host-local 的 subprocess 与 sandbox provider、`@deepseek-ai/dsh-science-runtime`（以 `dshHome` 与 `profiles` 配置）及其 `/invariant`，然后是本包（以 `profileId`、`modeRevision` 与 `stateHistoryLimit` 配置）及其自身的 `/invariant`。

`ctx.scienceRuntime` 相对于本包自身的 `inject` 而言是可选的——它静态注入的只有 `tools` 与 `systemPrompt`，并在最早需要它的操作（首次使用绑定，以及每次 `run_python`/`run_r` 调用）时才读取 `ctx.get('scienceRuntime')`。即使部署省略了 Runtime，本包仍会正常加载；此时对 `science`-preset session 的 assembly 会以清晰的错误拒绝，而不是悄悄降级。

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

每个 run 工具都要求 session 中记录的最新 `request/header`，以及确切的 tool-call ID；两者都会填入 `StartScienceRunRequest`。一次 durable 提交的 `success`、`failed`、`timed-out` 或 `cancelled` 终态就是该工具的结构化 canonical 值——包含受限的 stdout/stderr 文本、精确字节数与截断事实，绝不是原始的无边界输出。在 run-started 事实发布之前失败、process-tree 静止未被证明，或终态提交失败，都会改为 error tool 结果：意味着没有可信的 run 发生过。三个工具都使用通用（generic）渲染意图，不带编辑器位置信息。

## 模型体验

### 静态工具指引

#### 模型看到的内容

本包贡献一段固定的静态区段，描述 run 工具的进程模型、状态持久化规则，以及失败与错误的区分，原文照录如下。

##### Science 工具指引

```markdown
Use run_python or run_r to execute source in the session's bound Science environment. Each call starts a fresh interpreter process; no in-memory state survives between calls. Store anything that must survive between calls under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR. A terminal program failure (non-zero exit, exception, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction. A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed. Use get_science_state to read the current mode, environment, and run history without starting a process.
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

模型会看到生成的 [`get_science_state`、`run_python` 与 `run_r` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-science)。这些 schema 由本包无条件注册；目前没有任何已发布的 preset 将本包组合进某个 Host profile。

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

### 工具错误

#### 模型看到的内容

配置与前置条件失败会被规范化为 `Error: <message>`：`tool-science: code must be a non-empty string`、`tool-science: this tool requires an initiating Agent`、`tool-science: this tool requires a session bound to the science preset`、`tool-science: no request/header is recorded for this session`、`tool-science: no Science Runtime is mounted (ctx.scienceRuntime)`，以及 `tool-science: Science mode is not bound for this session`。

#### Token 影响

只有失败的调用才会新增这些保留 token。

#### KV Cache 影响

Append-only；新出现的内容跟在可复用的请求 prefix 之后，不会使已有的 KV cache 条目失效。

## 已知限制与暂缓事项

- **没有已发布的组合** — 本包不注册任何内置 Science preset、CLI/Web profile 行，或默认 Runtime 配置；部署方需要显式选择接入。参见 [R3 Agent Note](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md)。
- **工具 schema 不按 preset 限定范围** — 一旦本包被组合，`get_science_state`/`run_python`/`run_r` 就会全局注册；把它们限制到 `science`-preset session 而不是同一 Host 树中的每个 session，属于后续 preset 切片的职责。
- **没有图表或 Outcome 工具** — `science/chart-saved` 与 `science/outcome-published` 仍是没有生产者的 durable 词汇；这属于后续某个 Science 切片的职责。
- **没有持久化 kernel** — 每次 `run_python`/`run_r` 调用都是一个全新的解释器进程；只有 `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR` 中的文件会跨调用持久化。
