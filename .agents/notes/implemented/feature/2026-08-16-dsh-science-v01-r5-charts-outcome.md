# Agent Note: DSH Science v0.1 R5 charts and Outcome

Status: implemented

English | [中文](2026-08-16-dsh-science-v01-r5-charts-outcome.zh.md)

## Problem

R4 shipped an opt-in Science preset over the accepted Session, Runtime, and model-facing tool layers, but a successful analysis still ended as process output and ordinary prose. The durable `science/chart-saved` and `science/outcome-published` vocabularies already existed, while no trusted producer committed either event and no Web component rendered their values. A model could write a PNG below `SCIENCE_ARTIFACT_DIR`, but it could not turn that private run file into a replayable chart attachment or publish a cited Outcome.

The missing work was not a generic chart library. It was the Science-owned path from one successful run's private artifact to an immutable attachment, a durable chart version, a cited Outcome revision, and an accessible Web transcript. That path had to preserve the ownership established by R1-R4: Host paths stay private, the Session log remains the state authority, the Runtime owns its scratch tree, attachment bytes become durable before a reference is published, and the Science preset remains usable on the shipped text-only DeepSeek route.

A naive image-bearing tool result violates the last requirement. `ImageBlock` is model-visible history; the hand-written DeepSeek adapter rejects images instead of dropping them, so saving one chart could make the next Science request fail. A UI-only path that stores a bare attachment id in tool presentation metadata is also incomplete: attachment reads and Session ZIP export authorize only references found in recognized durable content carriers, and a crash between the Science event and `tool/result` could leave an accepted chart unreachable.

## Decision

R5 implements the `SCI-CHARTS-OUTCOME` slice over the accepted R4 closure head `fb04b0d273a6d4d3a319a4e8243c44953010f930`. It adds direct `save_chart` and `publish_outcome` tools to the shipped Science preset, a Runtime operation that imports one PNG from an owned successful run, a generic registry for domain-owned Session attachment references, and a `ui-science` Client Plugin that renders chart and Outcome tool occurrences. The range contains no settings, sidebar, prefix management, environment mutation, Desktop carrier, provider release, or package-publication work.

R5 makes a deliberate two-surface choice. The model-facing `save_chart` result is a bounded text receipt containing chart identity, version, source run, dimensions, byte count, and title; it carries no `ImageBlock`. The Web presentation reads the same durable `ImageAttachmentRef` and renders the PNG. `publish_outcome` returns the published title, Markdown summary, evidence references, and revision as model-visible text and renders the same publication as a dedicated Web row. A model that must inspect pixels still uses `read_image` on an explicitly image-capable route; saving and presenting a chart does not require such a route.

### Exact identities and dependency order

| Subject | Identity or rule | R5 use |
|---|---|---|
| Accepted product base | [R4 closure](2026-08-16-dsh-science-v01-r4-science-preset.md) head `fb04b0d273a6d4d3a319a4e8243c44953010f930` | Exact implementation base |
| R5 inventory row | [`SCI-CHARTS-OUTCOME`](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) | Sole product delta |
| Durable vocabulary | [R1](2026-08-15-dsh-science-v01-r1-science-session.md) `science/chart-saved` and `science/outcome-published` values and strict transitions | Reused without a second chart or Outcome authority |
| Runtime ownership | [R2](2026-08-15-dsh-science-v01-r2-science-runtime.md) private Session/run scratch and exact-session lease rules | Extended for artifact import; no Host path is exposed |
| Model Consumer | [R3](2026-08-16-dsh-science-v01-r3-science-tools.md) `@deepseek-ai/dsh-tool-science` | Two direct tools and guidance beside the existing three |
| Shipped composition | [R4](2026-08-16-dsh-science-v01-r4-science-preset.md) literal `science` preset and Web/CLI snapshot | The two tools plus Client/Host rows; the Runtime row stayed deployment-owned at R5 ([R6](2026-08-17-dsh-science-v01-r6-settings-details.md) later mounts it in the Web bundle only) |
| Downstream source | None | R5 is a fresh RC5-line design; no downstream implementation or evidence is inherited |

The plan separated R5 into three checkpoints — the domain-neutral registry, the Science producers, and the Web presentation — to be accepted at independent heads. The implementation landed instead as one ordered six-commit series on the R4 head, in exactly that dependency order, and every gate ran on the final combined candidate rather than on three separately accepted heads. The [dated R5 evidence record](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.md) binds each result to that candidate and states the deviation.

### Session attachment reference ownership

`@deepseek-ai/dsh-session-attachment-index` under `packages/session/session-attachment-index` provides `ctx.sessionAttachments`, the effect-owned and sole implementation for extracting trusted attachment references from Session events. Its built-in extractor absorbs the direct content, wrapped message, inserted message, completed assistant chunk, and nested tool-result image carriers; the local scanners in `api-proxy.ts` and `session-export.ts` are deleted, and both call sites consume the registry. A domain package registers an extractor for an event type; the extractor validates that event's own durable fields and returns complete `ImageAttachmentRef` values, never ids alone.

The package also owns an exhaustive attachment policy for `KNOWN_SESSION_EVENT_TYPES`, classified through two closed lists and gated for freshness against the generated known-type set. Every known event type is classified exactly once as built-in, attachment-free, or extractor-required; adding a known event without a policy fails that gate. `science/chart-saved` is extractor-required. If a log contains an extractor-required known type but its owning registration is absent, attachment reads fail with `SESSION_ATTACHMENT_EXTRACTOR_MISSING` and Session export fails before emitting a partial ZIP. Unknown ignorable events authorize nothing; malformed data for a registered known type fails extraction rather than degrading to an empty result.

`@deepseek-ai/dsh-science-session` registers `science/chart-saved` and returns exactly `chart.attachment` after the existing strict Science decoder accepts the event. `@deepseek-ai/dsh-host-apiproxy` uses the registry exclusively for both session-authorized attachment reads and Session ZIP media collection. The same accepted chart event therefore authorizes browser replay and archive export even if its later `tool/result` is absent. A reference in `tool/call` arguments, arbitrary JSON, another Session, an attachment-free event, or an unknown ignorable event does not authorize bytes.

The registry is generic because durable plugin events may legitimately own immutable attachments, while authorization and export must not import every product domain. It is not a second attachment store, projection, or garbage collector. `ctx.attachments` remains the only byte owner and integrity verifier; `ctx.sessionAttachments` answers only which complete references one Session log durably names. The Web Host mounts both the registry and `@deepseek-ai/dsh-science-session`; the latter now has a concrete production reader through chart presentation and attachment authorization, while its existing `science` projection reaches `ui-science` through the normal projection carrier.

### `save_chart` and Runtime artifact import

`ScienceRuntimeService` commits a chart from the exact live Session through one operation. Its request carries the Session, successful `runId`, slash-separated artifact-relative path, logical name, title, optional caption, authorizing tool call id, latest request-header sequence, and cancellation signal. The public request and result contain no Host path or mutable byte buffer.

The model-facing tool accepts these fields:

```ts
interface SaveChartArgs {
  run_id: string
  artifact_path: string
  logical_name: string
  title: string
  caption?: string
}
```

`artifact_path` is relative to that run's `SCIENCE_ARTIFACT_DIR`. Version one accepts only forward-slash segments and rejects empty paths, `.`, `..`, backslashes, absolute or drive/UNC forms, NUL, and values over the durable path limit. The resolved entry must be a regular non-symlink file whose canonical location remains inside the source run's private artifact directory. The source run must be durably successful, and its `science/run-started` event must satisfy `startedSeq >= (session.header.seedLength ?? 0)`. This immutable fork-lineage predicate is the only local-run boundary: resume does not change `header.seedLength`, while an inherited run has `startedSeq < header.seedLength` and may be cited by an Outcome but not imported from the child's private scratch.

When artifact selection fails, the diagnostic lists sorted safe relative paths from that run's artifact directory, bounded by validated `artifactDiagnosticMaxEntries` and `artifactDiagnosticMaxBytes` Runtime config fields, reports omitted entries, and never follows a symlink. An inherited-run diagnostic instead instructs the model to rerun in the child because no child-owned artifact directory exists for that provenance.

The Runtime rederives the source run directory from its durable `runDirectoryRef` and exact Session scratch owner, works after a Host restart of that same Session, and holds its existing non-queuing exact-Session lease through publication. Reading at most `ctx.attachments.imageLimits.maxImageBytes + 1` bytes is only a memory guard; `ctx.attachments.saveImage` remains the sole authority for the configured byte, pixel, decoded-media, and `mediaTypes` admission rules. The Runtime passes declared `image/png`; a deployment whose allowlist excludes PNG rejects `save_chart` loudly before an event is appended. The Runtime then rechecks liveness, current projection, the exact `startedSeq >= (header.seedLength ?? 0)` source predicate, and authorizing facts before appending `science/chart-saved`. Attachment persistence precedes the event; a failure before the event may leave only an unreferenced content-addressed object, while a committed event is never rolled back because a later tool-result append fails.

The first `logical_name` receives a new branded `ScienceChartId` and version `1`. A later save with the same logical name retains the id and increments the latest version by one; another logical name cannot reuse that id. The event inherits the source run's environment revision and fingerprint. `save_chart` is an exclusive tool with generic render intent and no editor location: its artifact-relative path is not a workspace file the client may open.

One shared direct-Science-mutation guard covers the producers. `run_python`, `run_r`, `save_chart`, and `publish_outcome` reject `exec.parent !== undefined` before Runtime lookup, filesystem work, or append. This includes a narrow R3 repair: nested Code Mode emits `tool/code-dispatch*`, not the direct `tool/call` provenance required by all four R1 transitions, and core tools omit `presentationMeta` for nested results. `get_science_state` remains a read-only nested call. The shipped Science preset stays native, but the explicit guard prevents a different composition from reaching a late invariant failure after side effects.

The canonical result contains the model-safe chart receipt and full attachment metadata. `output.render` emits text only. `output.presentationMeta` persists a tagged, versioned Science chart presentation value for the direct top-level result; it contains the same attachment reference and chart identity, never bytes, base64, an object URL, or a Host path.

`get_science_state` maps every recent projection chart through a `stateChart` sanitizer. Its model-facing entry retains chart id, logical name, version, title/caption, source run, environment revision, a fingerprint preview, dimensions, byte count, media type, and creation time; it omits `attachmentId`, full `environmentFingerprint`, `toolCallId`, and `requestHeaderSeq`. The full `ImageAttachmentRef` remains in the durable projection for authorization and UI replay, not in model state. This is the same text-receipt policy as `save_chart`, not a second chart history or an indirect image handle.

### `publish_outcome`

The direct exclusive tool accepts these model-facing fields:

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

Execution replays the exact live Science Session, requires the latest request header and this direct `publish_outcome` tool call, normalizes the next contiguous revision, and validates the candidate through the owning Science codecs and transition rules before append. Evidence must be non-empty and unique, name only prior facts, cite only successful runs and exact saved chart versions, and derive the exact sorted environment-revision set from run and chart evidence. Message-only evidence legitimately produces an empty environment-revision list. Title, Markdown, evidence count, timestamps, and identifiers retain the R1 durable bounds.

`@deepseek-ai/dsh-tool-science` appends `science/outcome-published` directly after validation. This Consumer ownership is intentional: publication performs no Host filesystem, attachment, subprocess, or lease operation, so routing it through `ScienceRuntimeService` would invent a Runtime responsibility. `save_chart` instead stays Runtime-owned because its attachment persistence, scratch authorization, and liveness rechecks must share the exact-Session lease. Either append remains subject to the existing strict Science invariant and appends nothing on a rejected candidate.

The successful canonical result contains the complete publication. Its model rendering includes the revision, title, summary, and evidence list so clients without Science UI still receive a useful result and the next model step sees exactly what was published; the result echoes evidence in the model's own argument vocabulary. A tagged, versioned presentation value preserves that exact revision for replay after a newer Outcome replaces the projection's current value. Outcome stays independent of Goal: publication neither reads nor changes Goal state, does not end a Goal, and cannot cite a Goal id.

### Web chart and Outcome presentation

`@deepseek-ai/dsh-client-ui-science` under `packages/client/ui-science` registers localized keyed `tool.call.toolview` rows for `save_chart` and `publish_outcome`. Both rows derive running, success, failure, and interrupted states from the frozen call/result slice, parse only their tagged versioned presentation values, and fall back to the generic tool row when arguments or metadata are old, absent, or invalid.

The chart row shows the logical name, version, title, optional caption, source run, dimensions, and byte count, then loads the durable PNG through the current Session-authorized image loader and reuses `ui-attachment` image/lightbox atoms. The toolview owner share carries the existing conversation `loadImage` callback forwarded through `ToolCallTree`; this is generic UI wiring, not a Science-specific byte loader or second URL cache. Loading, missing/corrupt attachment, retry, original preview, intrinsic sizing, keyboard navigation, focus restoration, and localized accessible names have focused tests.

The Outcome row renders the publication title and Markdown summary, labels run/chart/message evidence, and shows thumbnails for cited chart versions resolved from the `science` projection. It is a read-only transcript occurrence, not a second editor or a sidebar. Older Outcome rows use their own presentation metadata; current chart lookup comes from the durable projection. If the projection or a cited attachment is unavailable, the text publication and evidence ids remain visible and the row reports the missing visual without inventing a replacement.

The shipped Web composition mounts `session-attachment-index`, the Science Session Host plugin, and `ui-science`; at R5 it added no `science-runtime` row, and R5 preserved R4's deployment ownership for every composition. [R6](2026-08-17-dsh-science-v01-r6-settings-details.md) later mounts a settings-bound `@deepseek-ai/dsh-science-runtime/with-settings` row with an intentionally empty profile map in the shipped Web bundle specifically, so a live-capable Web deployment now names its `science` profile through that settings card and a Host restart rather than a separate deployment overlay. The base bundle and CLI/headless compositions without a browser still add no Runtime row, keep the two model-facing tools and text fallback, and keep the existing first-use missing-service/profile diagnostic. The exact Science roster is the R4 roster plus `save_chart` and `publish_outcome`. Standard and other presets acquire neither tool nor the Science UI behavior through a process-global registration.

### Assembled scenarios and documentation

The keyless assembled Science scenarios use the real Loader, agent loop, Session store, Science Session fold, attachment store, shipped preset, and Web scaffold plus an explicit test overlay that mounts the real Science Runtime with fake subprocess/sandbox providers. One run writes a deterministic valid PNG into its real owned artifact directory; `save_chart` commits version 1, a second save proves contiguous versioning, and `publish_outcome` cites the run and the exact chart version. The snapshots show text-only model results, the sanitized `get_science_state` chart entry, exact durable event order, tagged client presentation, no Host path or image bytes in the log, no nested mutation, and no Science tools in Standard. Message evidence is covered by the Consumer's unit suite rather than by an assembled transcript.

The runnable source scenario `examples/headless-agent/science-tools.cordis.snapshot.yml` mounts an attachment store beside the Runtime, because `save_chart` persists bytes before its event and the Runtime therefore waits for `attachments`. Its recorded model view pins all five Science tool schemas and the guidance section verbatim, and its recorded stream pins the durable event order. Chart identities tokenize separately from run identities so a chart cited as a run cannot normalize to the same expected text, and the environment-fingerprint preview normalizes with the fingerprint it previews.

Browser acceptance loads the real shipped Web composition against a deterministic stored Session/attachment fixture containing valid `science/chart-saved` and `science/outcome-published` events; it tests replay and does not claim the base Web bundle created the chart. It renders the chart and Outcome through the session-authorized attachment route, exercises reload/history replay and an older Outcome occurrence, inspects accessibility output and keyboard behavior, and proves that a missing or corrupt object fails visibly. Session export acceptance parses the raw Session artifact, proves the referenced PNG appears once in the ZIP, rejects a foreign or forged reference, and fails the whole export when a known extractor-required event lacks its owner.

Documentation updates cover the affected package README/JSDoc pairs, `docs/subsystems/science.*`, the Session subsystem page that owns the new registry, the capability-seam inventory, and the generated package/config/tool/service-graph catalogs. Volatile commands, SHAs, platforms, and pass/fail results live only in the dated R5 evidence triplet.

### Verification and closure

R5 evidence at the final candidate includes the affected package unit suites, the repository coverage gate, the keyless source snapshot lane, the Web browser lane including the shipped-fixture chart/Outcome replay, typecheck, lint, `doc-sync`, every hygiene sub-check outside the pre-existing `rescope-vendor:check` failure, whitespace and scope checks, and cross-file duplication compared against the R4 base. R5 also repairs the pre-existing `knip` failure that R4 recorded: the two `examples/headless-agent` Science fixtures are now declared entries of the examples workspace.

Real Python and R Runtime acceptance runs from a clean archive of the exact candidate with supported Node, a private non-`/tmp` `DSH_HOME`, and explicitly authorized existing Conda prefixes. Each language independently creates a real PNG below its provided `SCIENCE_ARTIFACT_DIR` and passes run, chart commit, attachment readback, chart replay, and Outcome publication with an unchanged prefix manifest. That evidence certifies neither provider credentials, Desktop, signing, nor release, which stay `NOT-RUN`.

### Supersession and lifecycle

R5 supersedes no active Agent Note. R1-R4 remain active because their durable semantics, Runtime ownership, Consumer rules, and shipped preset constraints continue to govern the Science line. The [durable attachment](2026-07-22-web-multimodal-image-input-and-durable-attachments.md), [minimal `read_image`](2026-08-10-minimal-read-image-tool.md), [tool presentation](../architecture/2026-08-08-client-tool-presentation-ownership.md), [Session projection](../../proposed/architecture/2026-07-27-session-projection-and-command-log.md), and [Session export](2026-08-10-web-session-log-export.md) decisions also remain independently useful; R5 consumes them without replacing their rationale. The proposed [Task Surface](../../proposed/feature/2026-08-04-task-surface.md) explicitly omits charts and is unrelated.

No implemented note qualifies for archive, no proposal is superseded or rejected, and no rejected guardrail becomes obsolete.

## Alternatives considered

**Return the PNG as an `ImageBlock` from `save_chart`.** Rejected because the block becomes model-visible tool-result history. The shipped default DeepSeek route explicitly rejects image input, so the next step would fail after an otherwise successful chart save. R5 instead returns a text receipt to the model and a durable attachment to the product UI; `read_image` remains the explicit image-capable model path.

**Authorize only the attachment reference copied into `tool/result.meta`.** Rejected because the Science event commits before the tool result and must remain sufficient after a crash. It would also make Session ZIP export depend on optional presentation data instead of the domain fact that owns the chart.

**Teach ApiProxy to import and special-case Science events.** Rejected because a generic Host package should not enumerate product domains. An effect-owned Session attachment-reference registry lets Science validate its own event while one authorization/export consumer remains domain-neutral.

**Authorize and export charts by querying the registered Science projection.** Rejected because Session export parses a raw stored artifact and may have no live projection, while a forked or cold Session must authorize inherited durable chart references from its own exact log. A projection is an optional current-state cache, not the generic or complete authority for attachment-bearing events. The event extractor registry operates over the raw log for both live reads and export.

**Store chart bytes or base64 in `science/chart-saved`.** Rejected because it duplicates immutable media in logs, projections, forks, queries, and exports. `ImageAttachmentRef` plus the content-addressed attachment store already supplies integrity and replay.

**Read an arbitrary workspace path through `save_chart`.** Rejected because the chart producer is the confined Science run, not a general filesystem write tool. Restricting import to a successful run's private `SCIENCE_ARTIFACT_DIR` preserves run provenance and avoids turning the Science Consumer into a second filesystem authority.

**Allow a child fork to save a chart from an inherited run's artifact path.** Rejected because private scratch is owned by the exact Session identity and the durable run reference intentionally omits a Host or ancestor path. A child may cite inherited durable runs and charts in an Outcome, but it reruns code locally before importing a new artifact.

**Add a Science sidebar or current-result dashboard in R5.** Rejected because the R0 inventory assigns navigation and current-state product placement to `SCI-SETTINGS-SIDEBAR`. R5 renders durable tool occurrences and cited visuals in the transcript only.

**Mount a default Science Runtime row in the base or Web bundle.** Rejected for R5 because R2 requires an explicit non-empty allowlist of existing Host Conda prefixes, and R5 neither discovers nor manages those paths. The shipped Web bundle gains the projection, attachment-index, and UI consumers; live creation continues to require a deployment overlay, and replay acceptance uses a stored fixture rather than implying a default Runtime. [R6](2026-08-17-dsh-science-v01-r6-settings-details.md) later qualifies this for the Web bundle only: it mounts a settings-bound Runtime row there, but with an intentionally empty profile map that still discovers or manages no Conda prefix — the same non-empty-allowlist requirement this alternative preserved, now reached through an explicit settings write and Host restart instead of a separate deployment overlay.

**Adopt a generic chart specification or plotting dependency.** Rejected because Python/R code already creates the output and the attachment service validates raster bytes. R5 owns publication, provenance, and presentation, not a plotting grammar or environment package manager.

## Consequences

The Science preset exposes exactly five Science tools — `get_science_state`, `run_python`, `run_r`, `save_chart`, and `publish_outcome` — and no other preset exposes either new tool. The shipped base bundle adds no Runtime row and keeps R4's loud missing-service/profile behavior; the shipped Web bundle mounts a settings-bound, intentionally unconfigured Runtime row as of [R6](2026-08-17-dsh-science-v01-r6-settings-details.md), while CLI/headless bundles still add none and keep R4's behavior, so live-capable acceptance elsewhere still mounts an explicit deployment or test overlay. A deployment without an attachment store now leaves the Science Runtime waiting for `attachments`, which is the same fail-loud posture as a missing `science` profile and is visible in Loader diagnostics.

`save_chart` imports only a PNG from a successful run whose `science/run-started` sequence satisfies `startedSeq >= (session.header.seedLength ?? 0)`, so the rule survives a same-Session restart and rejects inherited-run scratch. It persists bytes before the chart event, publishes no Host path, keeps logical versions contiguous, preserves environment provenance, and returns no model-visible image block. `ctx.attachments.saveImage` remains the only image-admission authority. `publish_outcome` appends one contiguous revision with a non-empty unique set of prior valid evidence and an exact derived environment-revision list, independent of Runtime and Goal. The registry is the only event-to-attachment scanner used by authorized reads and export, and a committed `science/chart-saved` event alone authorizes its exact attachment.

Saving attachment bytes before the chart event can leave an unreferenced content-addressed object when liveness, cancellation, or event commit fails. R5 accepts this bounded orphan because publishing an event before durable bytes would corrupt replay, while reference-aware garbage collection remains a separate storage policy. Retained Science run scratch and attachment objects continue to consume disk; R5 adds no automatic cleanup because a resumed Session, forked durable chart, or exported log may still need them, and quota policy requires its own design.

Fail-loud missing-owner behavior can make an old Session temporarily unreadable or unexportable under an incomplete deployment, which is preferable to a successful incomplete ZIP or a false unauthorized result. A permissive extractor could authorize an unintended reference, so registrations stay effect-owned, event-type-specific, and strictly validated, with cross-Session negative tests; arbitrary recursive JSON scanning is forbidden, and two live registrants for one event type are rejected rather than ref-counted.

Outcome Markdown and chart captions are model-authored durable prose. Existing codec bounds limit log and DOM cost, but misleading titles or summaries remain possible and are not converted into trusted scientific claims. Evidence links prove which prior facts were cited, not that the inference is scientifically correct. Real Python/R acceptance proves interpreter-to-artifact integration, not plotting-library availability for every user environment: R5 installs no packages and selects no Conda prefix.

R5 landed as one ordered series rather than three independently accepted checkpoint heads, so the risk control the plan assigned to separate acceptance now rests on the final combined candidate's gates and on the ordered range review recorded in the evidence. R5 closure changes only `SCI-CHARTS-OUTCOME`; settings/sidebar, Desktop, real-provider, publication, tag, push, and release remain outside the accepted claim, exactly as recorded in the R0-R4 overlay inventory.
