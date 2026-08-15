# @deepseek-ai/dsh-tool-science

English | [中文](README.zh.md)

The **model-facing Science mode Consumer**: first-use mode/environment binding, the `science:environment` dynamic context, and the `get_science_state`, `run_python`, and `run_r` tools. This is the Consumer role of the Science capability seam — [`dsh-science-session`](../science-session) is its Service Definition (durable events, strict fold, invariant), and [`dsh-science-runtime`](../science-runtime) is its Service Provider (`ctx.scienceRuntime`: environment observation, private scratch, direct execution, terminal classification). This package never spawns a process, writes run source, classifies termination, manages Conda, or appends a Runtime-owned event; every operation it performs goes through `ctx.scienceRuntime`.

A composition stacks, in order: `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-science-session` plus its `/invariant`, a host-local subprocess and sandbox provider, `@deepseek-ai/dsh-science-runtime` (configured with `dshHome` and `profiles`) plus its `/invariant`, then this package (configured with `profileId` and `modeRevision`) plus its own `/invariant`.

`ctx.scienceRuntime` is optional from this package's own `inject` — it statically injects only `tools` and `systemPrompt`, and reads `ctx.get('scienceRuntime')` at the first operation that needs it (first-use binding, and each `run_python`/`run_r` call). A deployment that omits the Runtime still loads this package; assembly for a `science`-preset session then rejects with a clear error instead of silently degrading.

## Config

Both keys are required; neither has a default, an environment-discovered value, or a shipped production identity in this package.

| Key | Meaning |
|---|---|
| `profileId` | Selects one allowlist entry in the composed `ctx.scienceRuntime`'s `profiles` config. Validated against the durable Science safe-ID grammar (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤128 characters). |
| `modeRevision` | Deployment-owned revision of the Science mode contract, persisted in every session's `ScienceModeRef`. Trimmed, non-empty, ≤128 characters. |

## First model request

On the first real Science prompt assembly for an Agent whose `session.header.agentPreset === 'science'`, this package replays the session. If `science/mode-bound` is absent, it appends one before any `step/start`, `request/header`, or `tool/call` — the durable Science Session applicability rule enforces that ordering independently. An existing mode's revision must equal the configured `modeRevision`; a mismatch rejects assembly before a request is built. If no durable environment exists, it calls `ctx.scienceRuntime.bindEnvironment({ session, profileId, signal })`; a durably applied or `invalid` result is a model-visible value either way, while a missing Runtime, cancellation, timeout, Host I/O failure, or confinement failure rejects assembly instead. A matching resumed session performs no automatic rebind — replay alone confirms both facts already hold. Diagnostic prompt assembly with no initiating Agent, or a non-`science`-preset session, performs no Host I/O and never appends a Science event.

After binding, this package re-renders the `science:environment` context from the just-committed projection and replaces that one named entry inside the assembly already in progress, before delegating exactly once through the `system-prompt/assemble` waterfall. The agent loop then records that current context as a `user/message` before `request/header`, so the first request — and every retried request within the same step — remains reconstructable from the session log.

## Tools

| Tool | Arguments | Behavior |
|---|---|---|
| `get_science_state` | none | Returns the exact session's bounded durable Science projection: mode, environment, run history, charts, and outcome. Rejects if Science mode is not yet bound. |
| `run_python` | `code` (non-empty string) | Runs `code` in a fresh Python interpreter process through `ctx.scienceRuntime.startRun`, forwarding the tool's cancellation signal. |
| `run_r` | `code` (non-empty string) | Runs `code` in a fresh `Rscript` process through `ctx.scienceRuntime.startRun`, forwarding the tool's cancellation signal. |

Each run tool requires the latest `request/header` recorded in the session and the exact tool-call ID; both feed `StartScienceRunRequest`. A durably committed `success`, `failed`, `timed-out`, or `cancelled` terminal state is the tool's structured canonical value — bounded stdout/stderr text, exact byte counts, and truncation facts, never raw unbounded output. Failure before the run-started fact publishes, unproven process-tree quiescence, or terminal-commit failure becomes an error tool result instead: no trustworthy run occurred. All three tools use generic render intent with no editor locations.

## Model Experience

### Static tool guidance

#### What the model sees

This package contributes one fixed static section describing the run tools' process model, state-persistence rule, and failure/error distinction, quoted verbatim below.

##### Science tool guidance

```markdown
Use run_python or run_r to execute source in the session's bound Science environment. Each call starts a fresh interpreter process; no in-memory state survives between calls. Store anything that must survive between calls under SCIENCE_STATE_DIR; store final output files under SCIENCE_ARTIFACT_DIR. A terminal program failure (non-zero exit, exception, timeout) is a result to inspect in the returned stdout/stderr, not a tool malfunction. A tool error result means no trustworthy run occurred: nothing executed, or its outcome could not be confirmed. Use get_science_state to read the current mode, environment, and run history without starting a process.
```

#### Token effect

Fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the guidance text is unchanged; plugin lifecycle may invalidate reuse from this section.

### `science:environment` dynamic context

#### What the model sees

For a `science`-preset session, the current mode revision; the bound environment's profile, revision, and status (with its failure reason when not applied); each configured interpreter's availability, version, and a truncated fingerprint, or its unavailable/invalid/drifted reason; the latest run's id, language, and status when one exists; and the fixed `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR` state rule. It omits source, stdout, stderr, credentials, and absolute Host paths. Outside Science mode, or for a diagnostic assembly with no initiating Agent, it renders `''` and contributes nothing.

#### Token effect

Bounded: one mode line, one environment line, up to two interpreter lines, and one latest-run line. Unchanged between requests, it adds no further tokens; a changed environment or new run replaces the whole snapshot.

#### KV Cache effect

Append-only while the rendered snapshot is unchanged: [`dsh-agent-loop`](../../core/agent-loop) appends a fresh `user/message` copy only when the context actually changed, was compacted away, or a retried request needs it restored — never on every step. A changed snapshot invalidates reuse from the first changed token, matching every other dynamic runtime context.

### Tool schemas

#### What the model sees

The model sees the generated [`get_science_state`, `run_python`, and `run_r` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-science). They are registered unconditionally by this package; no shipped preset currently composes it into a Host profile.

#### Token effect

Fixed schema cost on every request in this plugin's registration scope.

#### KV Cache effect

Prefix-stable while the visible tool definitions and order are unchanged. Plugin lifecycle may invalidate reuse from the first changed schema token.

### Run result

#### What the model sees

A durably committed run renders `status: <status>`, optionally suffixed ` exit <code>` and/or ` signal <signal>`, then `failureCode`/`failureMessage` lines when present, then `--- stdout ---`/`--- stderr ---` sections each showing the captured text or `(empty)`, with a `(stdout truncated)`/`(stderr truncated)` line when the Runtime's capture bound was reached. A non-success status is a first-class result to read, not an error.

#### Token effect

Bounded by the Runtime's stdout/stderr capture limits; the retained call and result are resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Science state result

#### What the model sees

`get_science_state`'s result is the JSON-rendered bounded projection: `mode`, `environment`, `runs`, `charts`, `outcome`, `metrics`, and `lastScienceEventSeq`, exactly as [`dsh-science-session`](../science-session) replays them — no source, stdout, stderr, credentials, or absolute Host paths.

#### Token effect

Grows with run/chart/outcome history until compaction; unbounded by this package (the durable projection itself has no size cap in R3).

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Configuration and precondition failures are normalized as `Error: <message>`: `tool-science: code must be a non-empty string`, `tool-science: this tool requires an initiating Agent`, `tool-science: this tool requires a session bound to the science preset`, `tool-science: no request/header is recorded for this session`, `tool-science: no Science Runtime is mounted (ctx.scienceRuntime)`, and `tool-science: Science mode is not bound for this session`.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No shipped composition** — this package registers no built-in Science preset, CLI/Web profile row, or default Runtime configuration; a deployment opts in explicitly. See the [R3 Agent Note](../../../.agents/notes/implemented/feature/2026-08-16-dsh-science-v01-r3-science-tools.md).
- **Tool schemas are not preset-scoped** — `get_science_state`/`run_python`/`run_r` register globally once this package is composed; a later preset slice owns restricting them to `science`-preset sessions rather than every session in the same Host tree.
- **No chart or Outcome tools** — `science/chart-saved` and `science/outcome-published` remain durable vocabulary with no producer in this package; a later Science slice owns them.
- **No persistent kernel** — every `run_python`/`run_r` call is a fresh interpreter process; only `SCIENCE_STATE_DIR`/`SCIENCE_ARTIFACT_DIR` files persist across calls.
