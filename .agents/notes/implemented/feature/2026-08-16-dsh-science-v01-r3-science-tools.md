# Agent Note: DSH Science v0.1 R3 model-facing Science tools on RC5

Status: implemented

English | [中文](2026-08-16-dsh-science-v01-r3-science-tools.zh.md)

## Problem

The accepted DSH Science v0.1 line had the official RC5 baseline, the durable Science Session domain, and the host-local Science Runtime, but no model-facing Consumer: no production package bound `science/mode-bound`, rendered the durable environment into a logged request-context snapshot, or exposed Python and R execution through the tool pipeline. The Runtime therefore had no accepted caller, and a future preset had no accepted Science tool package or read-only filesystem entry to compose.

The downstream Phase 3 candidate contained useful provenance for request-context restoration, a filesystem read-only subpath, and Science tools, but its six-commit range also included a built-in preset and failed whole-range hygiene and review. Its snapshot assembled prompt pieces directly instead of driving a real model request, its Agent Note lifecycle contradicted the implemented files, and its documentation did not completely describe request-context restoration. R3 re-derives the required behavior on the accepted R2 tree instead of adopting that candidate or its acceptance claims.

## Decision

R3 adds three ordered results to the accepted R2 head `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa`: generic runtime-context restoration before every model request attempt, the `@deepseek-ai/dsh-tool-fs/read-only` plugin entry, and the new `@deepseek-ai/dsh-tool-science` Consumer, each in its own commit. It closes the combined range with a test-only real application composition and exact-candidate evidence. It does not add a built-in Science preset or any shipped Host composition row.

The Session log remains the sole durable Science authority. `@deepseek-ai/dsh-tool-science` appends the one-time mode binding, asks `ctx.scienceRuntime` to append environment and run facts, replays `@deepseek-ai/dsh-science-session`, and registers model-facing prompt and tool contributions. It never spawns a process, writes run source, classifies termination, manages Conda, or appends Runtime-owned events.

### Exact identities

| Object | Identity | R3 use |
|---|---|---|
| Official source baseline | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, root version `0.1.0-rc.5` | Immutable upstream product baseline |
| Accepted R2 head | `dba4c1cdaaed209c8996e1a1bebca9b38c62d8aa` | Exact R3 implementation base; includes accepted R1 and R2 decisions and evidence |
| Runtime-context provenance | `omdsh-dev/dsh-science@0a940733e80d57c70245134bf260012f9be29114`, with test corrections at `e5e8b29b435f67e0a5dde5e2132580966e78b27b` | Read-only behavior and test input for `packages/core/agent-loop`; not a cherry-pick range |
| Read-only filesystem provenance | `omdsh-dev/dsh-science@8c7d5e01e3876b0c645f13f20ada8cf7add0c356` and loader correction `0073f6e0a11cd3444564cd1add5a252c70200b64` | Read-only subpath and loader/package-resolution input, re-derived against RC5 |
| Science Consumer provenance | `omdsh-dev/dsh-science@27c96d8e8b2431814fe70a2e94fe8feeaf207b63` | Package behavior and test input; generated output and failed Phase 3 acceptance are excluded |
| Rejected whole-range candidate | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` | Negative scope evidence only; its preset, review verdict, and check results are not R3 inputs |
| R3 product candidate | `50d5b413e59a3425c8936717e2ee369341324774` | Exact accepted R3 head; three linear commits above the R2 head |

The [R0 overlay inventory](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md#complete-overlay-inventory) owns the source identities and dependency order. The [R1 Science Session decision](2026-08-15-dsh-science-v01-r1-science-session.md) owns durable Science event and replay semantics. The [R2 Science Runtime decision](2026-08-15-dsh-science-v01-r2-science-runtime.md) owns environment/run operations, process lifecycle, confinement, and real-runtime evidence meaning. The [dated R3 evidence record](../../../../docs/evidence/2026-08-16-dsh-science-v01-r3-science-tools.md) owns volatile command output and platform facts.

### Scope

| Direction | Area | R3 result |
|---|---|---|
| IN | `GEN-RUNTIME-CONTEXT` | Restores the current dynamic context from the existing step assembly before every initial or retried request; focused loop/resume/retry tests and owning architecture/package documentation |
| IN | `FS-READONLY` | An independently mountable `@deepseek-ai/dsh-tool-fs/read-only` function plugin that shares the root read configuration and registers no mutation tool |
| IN | `FS-READONLY-LOAD-FIX` | Source Loader and built-package resolution, exact shared `Config` identity, package metadata, and disposal |
| IN | `SCI-TOOLS` | `@deepseek-ai/dsh-tool-science`, its required config, prompt/context rendering, three tools, invariant companion, package documentation, unit tests, and real-composition coverage |
| IN | Mechanical integration | Package metadata, TypeScript paths/references, lockfile importer, package/capability/tool/model-experience registrations, generators, generated English catalogs, and reviewed Chinese counterparts |
| IN | Closure evidence | This triplet in `implemented/feature` and one dated R3 evidence triplet containing exact SHAs, commands, results, exceptions, and `NOT-RUN` layers |
| OUT | Shipped composition | Built-in Science preset, CLI/Web preset manifests, shipped profile or bundle rows, default Runtime profile, real machine paths, and provider credentials |
| OUT | Later Science product work | Charts, chart save tools, Outcome publication, persistent kernels, package/environment management, settings, sidebar, Details UI, client rendering, and Desktop |
| OUT | Distribution and migration | RC6 or latest-upstream migration, installer, signing, notarization, Authenticode, tag, npm publication, GitHub release, and release-readiness claims |

Each implementation slice landed as a separate commit: `1cf4ef0ddd` (runtime-context restoration), `35ae6b5399` (filesystem read-only entry), and `50d5b413e5` (Science Consumer). R3 stops after closure; the next proposed slice is the built-in Science preset and its shipped CLI/Web composition.

### Generic runtime-context restoration

`ReactLoopAgent.preStep()` continues to assemble the prompt once, render dynamic contexts, project them through `RuntimeContextProjection`, and admit the candidate with the claimed messages. `step()` also re-renders contexts from that same `PromptAssembly` before every `buildRequest()` iteration, projects the current value, and appends a missing candidate before deriving messages. The ordinary first request emits no duplicate because the retained projection already observes the pre-step snapshot.

The loop does not call `systemPrompt.assemble()` again during request retry: a retry belongs to the same step assembly, and every `AssembledContext` in `PromptAssembly` already holds resolved text, so re-rendering repeats no provider I/O. A pressure compactor or request-error handler may replace the retained snapshot; the next request is built only after the projection observes the replacement and restores the current snapshot or clearing marker.

Focused tests in `packages/core/agent-loop/tests/request-error.spec.ts` assert the actual request messages and durable surface events for a compaction-replaced context restored before a retry, an unchanged retry that appends no duplicate, a cleared context restored after compaction removes it mid-retry, and no restoration after an unrelated replacement; the pre-existing `loop.spec.ts` suite covers the unchanged-first-request, malformed-retained-state, and cross-turn-clearing paths this change does not alter. `docs/architecture.md` and the agent-loop README describe the ordering.

This generic correction extends the current runtime-context mechanism; it does not supersede the Web runtime-context decision or add Science types to Core.

### Read-only filesystem entry

`@deepseek-ai/dsh-tool-fs/read-only` is a second function-plugin entry in the existing package, with its own `name`, `inject`, and `apply`. Both entries import `Config` and a shared `resolveReadCaps()` from a new `src/config.ts`, so `read-only` re-exports the exact root `Config` schema value rather than a copy. The root entry retains `read`, conditional `read_image`, `write`, and `edit`; the read-only entry registers only `read` and conditional `read_image`.

Conditional `read_image` may persist immutable attachment bytes through the separately composed attachment service. That side effect does not grant filesystem write or edit operations. A deployment that forbids attachment persistence omits that service; R3 does not change the attachment contract.

The package ships a `tsdown.config.ts` bundling `index`, `invariant`, and `read-only` as three flat `lib/` entries (the workspace default only bundles `index`/`invariant`/`startup`); `package.json` exports/files and `tsconfig.base.json`'s source-plane path map name the subpath explicitly, matching the `tool-subagent-control/list-agents` precedent. `packages/fs/tool-fs/tests/read-only-loader-composition.spec.ts` boots a real `cordis.yml` naming the bare subpath specifier through the Loader, proves the root and read-only rosters resolve independently, and proves an unrelated subpath specifier is rejected rather than silently resolving another entry. `packages/fs/tool-fs/tests/built-lib.e2e.ts` imports both the published root and subpath under plain Node from built `lib/`, proving shared `Config` object identity survives the build, the read-only roster excludes `write`/`edit`, and the shared resolver rejects an invalid config at the read-only entry too. Disposal removes only the registrations from the disposed mount, since Cordis effects scope each `ctx.tools.register(...)` call to its own plugin fiber.

The entry remains in the existing npm package because its dependencies, configuration, implementation, and release lifecycle remain shared with the full filesystem tool package. A separate package would require a later ownership change.

### Science Consumer package

#### Configuration and eligibility

`@deepseek-ai/dsh-tool-science` is a function plugin with required `profileId` and `modeRevision` configuration. `profileId` uses the durable Science safe-ID grammar (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, ≤128 characters) and selects one Runtime allowlist entry. `modeRevision` is trimmed, non-empty, and bounded to 128 characters, persisted in `ScienceModeRef`. Neither value has a default, comes from environment discovery, or names a shipped production profile.

The plugin statically injects only `tools` and `systemPrompt`. It reads the optional Host-owned Runtime with `ctx.get('scienceRuntime')` at the earliest operation that needs it — first-use binding, and each `run_python`/`run_r` call. Model-facing operations require an exact initiating Agent whose Session header names the `science` preset identity (`session.header.agentPreset === 'science'`). Diagnostic prompt assembly without an Agent and turn signal performs no Host I/O and delegates unchanged.

#### First model request

On the first real Science prompt assembly, the Consumer replays the Session. If mode is absent, it appends `science/mode-bound` before `step/start`, `request/header`, or any tool call — the durable Science Session applicability rule enforces that ordering independently, since the append happens inside `preStep()`'s `systemPrompt.assemble()` call, strictly before `turn()` appends `step/start`. An existing mode's revision must equal the configured `modeRevision`; a mismatch rejects assembly before request construction.

If no durable environment exists, the Consumer calls `ctx.scienceRuntime.bindEnvironment()` with the exact live Session, configured branded profile, and assembly signal. A durable `invalid` environment remains a model-visible value, while missing Runtime, cancellation, timeout, Host I/O failure, or confinement failure rejects assembly. A matching resumed Session performs no automatic rebind — replay alone confirms both facts already hold.

Context providers render before the assembly waterfall completes. After binding, the Consumer replays the projection and replaces the named `science:environment` entry inside the existing assembly, reading the waterfall's own `next()` result rather than assuming object identity, before delegating exactly once. The agent loop then records that current context as a `user/message` before the request header, so the first request — and every restored retry within the same step — remains reconstructable from the Session log.

#### Context and tool contracts

A static `tool:science` prompt section states that each Python or R call starts a fresh process, reusable state belongs in `SCIENCE_STATE_DIR` or `SCIENCE_ARTIFACT_DIR`, terminal program failure is a result to inspect, and infrastructure failure means no trustworthy run result exists. The deterministic `science:environment` dynamic context contains only durable mode, environment, interpreter capability/version, bounded safe reasons and a truncated fingerprint, the file-based state rule, and a bounded latest-run summary. It omits source, stdout, stderr, credentials, and absolute Host paths, and renders `''` outside Science mode or without an initiating Agent.

The package registers exactly `get_science_state`, `run_python`, and `run_r`, using generic render intent and no editor locations. `get_science_state` accepts no arguments and returns the exact Session's bounded durable projection (`mode`, `environment`, `runs`, `charts`, `outcome`, `metrics`, `lastScienceEventSeq`). Each run tool accepts one non-empty `code` string, requires the latest `request/header` and exact tool call ID, forwards the tool cancellation signal to `startRun()`, and awaits the returned handle.

A durably committed `success`, `failed`, `timed-out`, or `cancelled` terminal state is a structured tool value containing bounded stdout/stderr text, exact byte counts, and truncation facts — its `ScienceRunValue` type is derived with `InferValue<typeof runOutputSchema>` rather than hand-duplicated, so the schema and the runtime shape cannot drift under `exactOptionalPropertyTypes`. Failure before start publication, unproven process-tree quiescence, or terminal-commit failure becomes an error tool result. The Consumer does not revalidate typed same-process Runtime values; config, durable events, tool JSON, and service availability remain the validation points.

The package's invariant companion registers an explained empty installer because the Science Session invariant owns the durable event/projection relationship and the Consumer owns no additional authoritative mutable relation. `packages/science/tool-science/tests/tool-science.spec.ts` proves registration and disposal are effects: disposing the plugin fiber removes the three tool schemas and the `science:environment` context entry.

### Verification and closure

R3 source evidence includes focused per-file 100% coverage for changed Core, filesystem, and Science source; adjacent package tests for shared behavior; typecheck; build; package invariants; documentation synchronization (including bilingual pairing for every touched English document); lint; and whitespace checks. Package/export changes additionally passed publint, NodeNext consumer types, the affected hygiene checks, and plain-Node built-root/subpath smokes.

The product-visible Consumer required a keyless REAL-composition test. `packages/science/tool-science/tests/loader-composition.spec.ts` boots a test-only `cordis.yml` through the Loader with the real agent loop, Session store, Science Session invariant, Science Runtime (composed with deterministic fake subprocess/sandbox providers, not a real Conda prefix), real session persistence (`@deepseek-ai/dsh-session-persistence-jsonl`), the tool pipeline, and the Consumer. It asserts the actual first model request carries the logged `science:environment` context, durable event ordering (`science/mode-bound` before `science/environment-bound` before `step/start` before `request/header` before `tool/call` before `science/run-started` before `science/run-finished`), the exact three Science schemas, a `run_python` result through the real tool pipeline, resume behavior (dispose the live agent, resume the exact persisted Session, run again with no rebind and no duplicate mode/environment events), and absence of every `science/*` event and `science:environment` context text from a Standard (non-science-preset) session in the same composition.

Real Python and R Consumer acceptance against explicitly authorized existing Conda prefixes remains `NOT-RUN` for R3, tracked separately from this keyless evidence. Preset, Web, browser, Desktop, provider credentials, signing, publication, and release remain `NOT-RUN`. The [dated R3 evidence record](../../../../docs/evidence/2026-08-16-dsh-science-v01-r3-science-tools.md) binds every result and exception to the accepted candidate SHA.

### Supersession and lifecycle

R3 does not supersede the R1 Science Session or R2 Science Runtime decisions. It consumes their public responsibilities and completes the current Runtime capability with a model-facing Consumer. The generic runtime-context correction extends the active system-prompt/session mechanism, and the read-only entry extends the current filesystem package; their existing decisions remain independently useful and active.

The downstream Phase 3 proposal is provenance from the excluded lineage and was not copied into the active tree. The next proposed slice is the built-in Science preset and its shipped CLI/Web composition; custom deployments may compose `@deepseek-ai/dsh-tool-science` explicitly before that slice lands, but project documentation must not call Science Mode shipped or release-ready until the preset, application, product UI, artifact, and release layers pass their own decisions and evidence.

## Alternatives considered

**Adopt or cherry-pick the downstream Phase 3 range.** Rejected because the range mixes generic prerequisites, Science tools, a preset, generated outputs, a hygiene failure, and an unaccepted request-path snapshot. Provenance SHAs identify behavior to re-evaluate, not a patch or evidence boundary for the RC5 line.

**Include the built-in Science preset in R3.** Rejected because preset composition has independent CLI/Web, resolver, snapshot, browser, and packed-Web responsibilities. Accepting the Consumer first made the next slice a bounded composition decision and kept a preset fixture from substituting for the Consumer's request-path evidence.

**Defer the read-only filesystem entry until the preset.** Rejected because the approved Science capability roster requires discovery and reading without mutation, and the generic package/loading behavior needed independent ownership and built evidence. Completing it in R3 keeps the later composition slice from carrying generic filesystem implementation.

**Create a separate read-only filesystem npm package.** Rejected because configuration, read implementation, dependencies, and release lifecycle remain shared. A second package would duplicate ownership without enabling independent evolution.

**Bind the environment at Session creation or hard-inject the Runtime.** Rejected because Session-start notification cannot await or veto Host I/O, unused Sessions should not probe Conda, and Runtime remains Host deployment configuration rather than an agent-scope package dependency. First real asynchronous assembly has the exact Agent and cancellation signal and fails before a request.

**Reassemble the system prompt before retry.** Rejected because retries belong to the same step assembly and repeated assembly can repeat Host effects. Re-projecting the existing assembly restores only the logged context that replacement removed.

## Consequences

R3 gives Science its first model-facing Consumer without importing downstream history or a shipped composition. Every science-preset request now carries a durably reconstructable mode/environment snapshot, and `run_python`/`run_r` reach `ctx.scienceRuntime` through the ordinary tool pipeline with bounded, structured results. The cost is a required per-retry re-projection path in the generic agent loop (exercised by four new focused tests) and a Runtime that still has no shipped composition: preset, Web, and Desktop slices remain open.

First-use prompt assembly performs one Host environment observation and can delay the first request; the request-path tests cover cancellation, timeout, static invalid bindings, operational failure, and matching-resume behavior so a slow or failed observation cannot publish a partial model contract. Retry restoration relies on the existing step assembly remaining authoritative for that step; a future feature that needs new Host facts between retries requires a separate logged update operation, not a re-run of assembly. A package subpath with its own Cordis plugin identity is less obvious than a separate package; shared schema identity, package documentation, source Loader coverage, and built import coverage keep that topology explicit, with the `tool-subagent-control/list-agents` precedent as the named model for a later split.

Real Python and R Consumer acceptance, preset composition, Web/Desktop application layers, and release readiness remain exactly as recorded in the R0 overlay inventory: open work for later slices.
