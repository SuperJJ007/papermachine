# @deepseek-ai/dsh-science-session

English | [中文](README.zh.md)

The Science Session domain: durable required-on-read Session events, strict deterministic replay, a pre-commit invariant, and the optional `science` session projection. This package exposes no mutation service, starts no process, observes no interpreter, registers no model-facing tool or prompt, and renders no client UI — a later Science Runtime and its tool Consumers append the events this package validates and projects.

## Durable vocabulary

Six `science/*` Session events, each `version: 1`, lossless JSON, carrying a complete domain value rather than a patch, and required on read (never `ignorable`): `science/mode-bound`, `science/environment-bound`, `science/run-started`, `science/run-finished`, `science/chart-saved`, `science/outcome-published`. `science/mode-bound` is legal once, only for a Session whose `agentPreset` is `science`, and before the first Science-preset `step/start`, `request/header`, or `tool/call` fact. Environment, run, chart, and Outcome types exist as durable vocabulary even though their producers (Science Runtime, tools) are a later slice.

## Strict fold and invariant

`replayScience(events)` deterministically replays a complete contiguous log into the public `ScienceProjection`, or `null` before a valid mode binding. The fold rejects discontinuous sequences, malformed values, invalid transitions, forward provenance (a `requestHeaderSeq`/`toolCallId` must name the latest post-mode fact of its kind), reused or settled tool calls, non-monotonic revisions or times, and foreign evidence. `session/end-seed` alone derives `interrupted` for an unmatched running run; no synthetic Science terminal event is appended. The package-owned invariant (`./invariant`) applies the same applicability rule and strict fold before every commit, so a rejected candidate appends nothing to the durable log.

## Projection

Registers the optional `science` key on `ctx.sessionProjections` only when that registry is composed (`ctx.inject(['sessionProjections'], …)`); a host without the registry, or a Standard (non-Science) session, never carries the key. The persisted private state is plain JSON at `stateVersion: 2`: an observed-event watermark, the encoded strict fold, and a sparse redacted witness. `checkpointStateSchema` admits a persisted row only when replaying its witness reproduces the encoded fold and the row's outer `seq`; `checkpointStateSeq` binds every state to that same watermark so a valid-but-stale state can never be spliced under a newer one; `viewChanged` narrows public-change notification to transitions that actually moved `lastScienceEventSeq`, since supporting events (tool calls, request headers) can advance the private watermark without changing the public value.

## Model Experience

None, as this package validates and projects already-logged Session facts and touches no prompt, message, schema, stream, or tool result; a later Science tool Consumer is a separate package.

#### KV Cache effect

None; this package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **No producer exists yet.** Science Runtime and its tool Consumers, which append these events from real Python/R execution, are a later slice; this package only validates and replays a durable vocabulary that a test or future Consumer supplies.
- **The sparse projection witness retains provenance, not a bounded window.** It grows with retained Science facts; no constant-time or bounded-history claim is made, matching the accepted trade-off in the generic `session-projection` registry's own checkpoint contract.
- **No Science-specific client UI, settings, or sidebar.** Those are later product-decision-gated slices; this package's `ScienceProjection` is a plain wire value with no rendering opinion.
