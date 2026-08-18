# @deepseek-ai/dsh-science-session

English | [中文](README.zh.md)

The Science Session domain: durable required-on-read Session events, strict deterministic Host replay, a pre-commit invariant, the optional client-safe `science` Session projection, and the `science/artifact-saved` attachment extractor. This package exposes no mutation service, starts no process, observes no interpreter, registers no model-facing tool or prompt, and renders no client UI. `@deepseek-ai/dsh-science-runtime` appends environment, run, and artifact events; `@deepseek-ai/dsh-tool-science` binds mode and publishes Outcomes.

## Durable vocabulary

Six `science/*` Session events, each `version: 1`, lossless JSON, carrying a complete domain value rather than a patch, and required on read (never `ignorable`): `science/mode-bound`, `science/environment-bound`, `science/run-started`, `science/run-finished`, `science/artifact-saved`, `science/outcome-published`. `science/mode-bound` is legal once, only for a Session whose `agentPreset` is `science`, and before the first Science-preset `step/start`, `request/header`, or `tool/call` fact. `science/artifact-saved` generalizes the durable model beyond charts: an artifact version carries an always-populated `title`, an optional `caption`, an `origin` of `'auto'` (unattended capture) or `'model'` (curated), and its complete `ImageAttachmentRef | TextAttachmentRef`; `logicalName` is a forward-slash path (each segment the same safe grammar as every other durable id) so a captured file's path relative to its run's artifact directory is a legal logical name directly. It may reference any run that reached a terminal status — success, failed, timed-out, or cancelled — not only a successful one, since a failed run's partial output is still eligible for capture. Outcomes retain non-empty references to prior successful runs, exact artifact versions, and/or message facts.

## Strict fold and invariant

`replayScience(events)` deterministically replays a complete contiguous log into the complete Host-side `ScienceProjection`, or `null` before a valid mode binding. The fold rejects discontinuous sequences, malformed values, invalid transitions, forward provenance (a `requestHeaderSeq`/`toolCallId` must name the latest post-mode fact of its kind), reused or settled tool calls, non-monotonic revisions or times, and foreign evidence. A curation-only re-save that repeats an identical `attachment` with a changed `title`, `caption`, or `origin` still commits the next contiguous version — the fold applies no content-hash dedup of its own; a caller that wants to skip an unchanged file compares content hashes itself before appending. An `origin: 'auto'` artifact version's `toolCallId`/`requestHeaderSeq` must equal its source run's own (already proven when that run started), since unattended capture is not a distinct model-issued call and never re-consumes one — many files captured from one run share that run's call. An `origin: 'model'` version consumes a fresh, distinct tool call exactly once, as `save_chart` always has. `session/end-seed` alone derives `interrupted` for an unmatched running run; no synthetic Science terminal event is appended. The package-owned invariant (`./invariant`) applies the same applicability rule and strict fold before every commit, so a rejected candidate appends nothing to the durable log.

## Projection

Registers the optional `science` key on `ctx.sessionProjections` only when that registry is composed (`ctx.inject(['sessionProjections'], …)`); a host without the registry, or a Standard (non-Science) session, never carries the key. The public `ScienceClientProjection` keeps mode, path-free environment capability/version/package-inventory summaries, run status/history, artifact attachment references, the latest Outcome, and metrics. Run and artifact records retain their authorizing `toolCallId` and `requestHeaderSeq` — session-log identities the browser already holds — so the client can join a run or artifact version to its transcript tool call with no additional Host route. A run record also retains its whole `codeSha256`, unlike the environment fingerprint: it is a digest over source text the same transcript call already restates verbatim once resolved, so it carries no Host-infrastructure fact, and provenance needs the durable anchor exact rather than previewed. It omits configured/canonical prefixes, executable paths and identity, full environment and package-inventory fingerprints (twelve-character previews only), source/scratch facts, and free-text Runtime failures. The persisted private state is plain JSON at `stateVersion: 3`: an observed-event watermark, the encoded strict fold, and a sparse redacted witness. `checkpointStateSchema` admits a persisted row only when replaying its witness reproduces the encoded fold and the row's outer `seq`; `checkpointStateSeq` binds every state to that same watermark so a valid-but-stale state can never be spliced under a newer one; `viewChanged` narrows public-change notification to transitions that actually moved `lastScienceEventSeq`, since supporting events can advance the private watermark without changing the public value.

## Attachment authorization

When `ctx.sessionAttachments` is composed, this package registers the sole extractor for `science/artifact-saved`. It strictly decodes the event and returns its complete artifact attachment reference. A missing owner or malformed event fails authorization and Session export instead of authorizing an empty set.

## Model Experience

None, as this package validates and projects already-logged Session facts and touches no prompt, message, schema, stream, or tool result; the Science tool Consumer is a separate package.

#### KV Cache effect

None; this package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The sparse projection witness retains provenance, not a bounded window.** It grows with retained Science facts; no constant-time or bounded-history claim is made, matching the accepted trade-off in the generic `session-projection` registry's own checkpoint contract.
- **No settings or current-state Details UI.** `@deepseek-ai/dsh-client-ui-science` renders chart and Outcome transcript occurrences; settings and a current-state Details entry remain later product work.
