# Agent Note: DSH Science v0.1 R4 built-in Science preset on RC5

Status: implemented

English | [中文](2026-08-16-dsh-science-v01-r4-science-preset.zh.md)

## Problem

The accepted DSH Science v0.1 line had the official RC5 baseline, the durable Science Session domain, the host-local Runtime, and the model-facing Science Consumer, but shipped no `science` agent preset. A deployment could compose `@deepseek-ai/dsh-tool-science` manually, yet the shipped CLI/Web preset root exposed no bounded Science roster and the preset picker had no Science entry. R3 therefore remained a package-level capability rather than an application composition.

The downstream preset candidate at `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01` was provenance, not an acceptable patch. It belongs to the rejected whole-range Phase 3 candidate, predates R3's required `stateHistoryLimit`, and proves its model-visible result by calling prompt assembly directly instead of driving a real model request. Copying it would also have inherited stale generated and documentation assumptions from a different tree.

R4 needed one bounded composition decision that made the accepted R3 Consumer selectable through the shipped CLI/Web application, defined how that fixed Science identity interacts with preset authoring, and preserved Host ownership of Runtime configuration. It had to not turn preset wiring into production invariants, an unused Session projection, chart/Outcome production, Science settings, a Desktop carrier, Conda discovery, or a release claim.

## Decision

R4 adds the built-in `science` preset, an explicit non-copyable policy for its fixed durable identity, localized built-in display copy, resolver/package metadata, browser replay fixtures, and an application-level keyless Web snapshot. The preset is opt-in and `standard` remains the default. R4 closes only the `SCI-PRESET` overlay row; `SCI-CHARTS-OUTCOME`, `SCI-SETTINGS-SIDEBAR`, and `DESKTOP-CARRIER` remain open.

The [R0 overlay inventory](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md#complete-overlay-inventory) owns the dependency order and evidence-layer split. The [R1 Science Session decision](2026-08-15-dsh-science-v01-r1-science-session.md) owns durable Science events and replay. The [R2 Science Runtime decision](2026-08-15-dsh-science-v01-r2-science-runtime.md) owns explicit existing-prefix configuration and process lifecycle. The [R3 Science tools decision](2026-08-16-dsh-science-v01-r3-science-tools.md) owns the Consumer, runtime-context restoration, read-only filesystem entry, and model-facing schemas/results. R4 composes those accepted responsibilities without changing their package APIs or durable Science event fields.

### Exact identities

| Object | Identity | R4 use |
|---|---|---|
| Official source baseline | `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`, version `0.1.0-rc.5` | Immutable upstream product baseline |
| Accepted R3 documentation-closure head (R4 plan base) | `92ee890e8da762ba789e74610551b4fd3351ed27` | Exact R4 implementation base |
| Repaired R4 behavior candidate | `cda69a9e5f6fb729c4699f70e06dc23745f0788f`, nine linear commits above the plan base | Exact accepted source behavior after the final copy-policy repair |
| Downstream preset provenance | `omdsh-dev/dsh-science@fae091e1080e830bed8ad0456e4cbced29101b01`; preset commit only | Read-only roster, locale, and test input; no patch or acceptance inheritance |
| Rejected downstream range | The Phase 3 range ending at `fae091e1080e830bed8ad0456e4cbced29101b01` | Negative scope and review evidence only |

No downstream test, snapshot, review verdict, real-machine report, dirty worktree, RC6 artifact, or later upstream source was R4 acceptance evidence. The [dated R4 evidence record](../../../../docs/evidence/2026-08-16-dsh-science-v01-r4-science-preset.md) owns the nine commit identities, worktree state, exact toolchain, commands, results, platform facts, exceptions, and `NOT-RUN` layers.

### Scope

| Direction | Area | R4 result |
|---|---|---|
| IN | `SCI-PRESET` | `apps/cli/config/agent-presets/science/{agent.cordis.yml,preset.yml}` with the exact bounded roster, project instructions, metadata, and explicit Science Consumer policy |
| IN | Copy-safe preset authoring | A generic, explicit preset-copyability field that defaults to copyable only for healthy presets; shipped metadata is required and validated, every broken source fails closed, the built-in `science` metadata disables copying, `ctx.agentPresets.copy()` and `agentPreset.copy` reject it, and Web exposes no actionable copy path |
| IN | Application integration | `apps/cli` dependencies, lockfile importer changes, preset discovery, localized built-in display copy, and focused CLI/client composition tests |
| IN | Browser and model-visible acceptance | Updated shipped-roster ARIA goldens plus a keyless `apps/web` snapshot that mounts the exact shipped preset and drives a real request through the Web scaffold, Loader, preset registry, and agent loop |
| IN | Current documentation and closure | Affected package/application docs and generated artifacts, this Note's lifecycle change, and the dated R4 evidence record |
| OUT | Production invariant and projection composition | `@deepseek-ai/dsh-invariants`, every `*/invariant` row, and a Host `@deepseek-ai/dsh-science-session` row while no shipped Web read path consumes its optional projection |
| OUT | Runtime defaults and environment management | `science-runtime` Host row, real paths, profile discovery, Conda create/clone/install/update/repair/delete, implicit profile selection, credentials, or provider defaults |
| OUT | R1-R3 behavior changes | Science event schemas/fold, Runtime operations, runtime-context restoration, filesystem read-only implementation, or Science tool schemas/results |
| OUT | Later Science product work | `save_chart`, chart renderers, `science/chart-saved` producers, Outcome publication, settings projection/card, Science sidebar/Details UI, persistent kernels, package management, and publication tools |
| OUT | Distribution and migration | Desktop carrier, installer, signing, notarization, Authenticode, npm publication, tag, GitHub release, Git push/PR, RC6 adoption, or latest-upstream migration |

### Preset identity, metadata, and roster

The preset id is `science`, its display order is `5`, and the application default remains `standard`. Its `preset.yml` metadata is Chinese, matching the shipped convention: `name: Science 模式` and `description: 面向可复现 Python/R 分析的受限 Agent，提供只读工作区、技能和持久 Science 状态工具。` Web localizes that system-trusted row to `Science mode` and `Restricted agent for reproducible Python/R analysis with a read-only workspace, skills, and durable Science state tools.` for English, or the same Chinese copy for Chinese; a user-authored preset with the same id retains its own metadata under the existing trust rule.

The `@deepseek-ai/dsh-tool-science` row sets `profileId: science`, `modeRevision: science-v1`, and `stateHistoryLimit: 8`. These values are explicit preset policy, not package defaults or environment discovery. The history limit applies independently to recent runs and chart versions returned by `get_science_state`; changing it changes model-visible output and requires matching decision, documentation, and snapshot updates.

The preset composes the Science persona, `@deepseek-ai/dsh-agent-instructions` with `maxBytes: 65536`, `@deepseek-ai/dsh-tool-science`, `@deepseek-ai/dsh-tool-fs/read-only`, `@deepseek-ai/dsh-tool-fs-search`, basic compaction plus its compact command and result pruner in one isolated realm, `@deepseek-ai/dsh-skill-filesystem`, `@deepseek-ai/dsh-tool-skill`, `@deepseek-ai/dsh-tool-ask-user`, and `@deepseek-ai/dsh-tool-todo`. Science sessions therefore consume applicable project `AGENTS.md` instructions as model-visible prompt content. The keyless snapshot pins their presence alongside the Science persona rather than treating a tool roster assertion as prompt coverage.

In the shipped Web Host with image attachments and packaged ripgrep available, the exact model tool roster is `ask_user_question`, `get_science_state`, `glob`, `grep`, `read`, `read_image`, `run_python`, `run_r`, `skill`, and `todo_write`. The roster excludes bash/pwsh, filesystem write/edit, `str_replace_editor`, jobs, Goal, plan mode, subagents, workflows, Ralph, Code Mode, self-modification, Web search, chart/Outcome publication, and every other tool not named above. `apps/cli/tests/web-agent-presets.e2e.ts` asserts the assembled roster and per-preset scope; absence from YAML alone is not the evidence.

R1 and R3 deliberately bind `ScienceModeRef.presetId` and Consumer eligibility to the literal `science` preset. A byte-for-byte `science-copy` would mount the three Science tools but could not bind or execute them. R4 does not expose that user-reachable failure as successful authoring: preset metadata gains an explicit `copyable` boolean, `science/preset.yml` sets `copyable: false`, the service and Host API reject direct copy requests with a diagnostic naming the source (`PresetNotCopyableError`, wire code `agent-preset-not-copyable`), and Web renders the Science copy action disabled with a localized reason (`notCopyable`, distinct from the broken-preset `brokenNoCopy` reason). Healthy user presets may omit metadata and default to copyable; shipped system presets must provide readable map metadata, any declared `copyable` value must be boolean, and every broken preset resolves non-copyable. Missing, malformed, unreadable, wrongly shaped, or wrongly typed policy therefore fails closed in discovery and direct authoring. The [copy-only authoring decision](../simplification/2026-08-08-copy-only-preset-authoring.md) remains the owner of the authoring mechanism; supporting derived Science preset ids remains a separate R1/R3 durable-identity decision.

### Host, Session, and Runtime ownership

Science event admission was already a repository build fact before R4. `packages/core/session/src/known-event-types.ts` is generated from the merged `SessionEventMap` and already contains all six `science/*` types; Web Host composition neither admits nor rejects those types because of R4.

R4 does not mount `@deepseek-ai/dsh-invariants` or any `*/invariant` companion in the shipped Web Host. Those companions run in the Vitest host through `scripts/test-invariants.ts`; making them production rows remains a separate performance and failure-policy decision because every event would run strict relational checks.

R4 also leaves `@deepseek-ai/dsh-science-session` out of the Web Host. Its runtime `apply` only registers the optional `science` projection when `ctx.sessionProjections` exists, while the R3 Consumer reconstructs its context and state directly with `replayScience(session.events)`. No R4 Web read path consumes the projection or its checkpoints. A later settings/sidebar, transcript, or query surface that needs incremental Science projection state must own that Host row and its checkpoint evidence.

`ctx.scienceRuntime` remains explicit deployment configuration. A usable deployment must mount `@deepseek-ai/dsh-science-runtime` with a profile whose id is exactly `science`; the preset carries no path, selects no first configured profile, and manufactures no fallback.

R4 accepts a visible but deployment-dependent built-in preset. A default Web deployment with no Science Runtime can discover and select `science`, but the first real Science assembly fails before an environment event, request header, or provider call. The error names either the missing Host service (`ctx.scienceRuntime`) or the missing `science` profile — confirmed in `apps/cli/tests/web-agent-presets.e2e.ts` — R4 neither hides the preset, silently switches to Standard, discovers a machine path, nor claims the deployment is Science-ready. The one-time mode binding may already be durable and is resumed rather than rolled back.

The built-in `modeRevision: science-v1` is a durable identity. A session bound to another revision continues to fail loudly under R3's rule. A future revision change must decide whether to reject, migrate, or fork the preset identity; changing the YAML string alone is not a compatible upgrade.

### Application and snapshot evidence

The primary application-level keyless snapshot is `apps/web/tests/science-preset.snapshot.ts`. It follows `apps/web/tests/minimal-preset.snapshot.ts`: it launches the shipped Web scaffold with a replay fixture and a fake-backed (real `@deepseek-ai/dsh-science-runtime`, fake subprocess/sandbox providers, isolated through `ctx.isolate('subprocess').isolate('sandbox')`) Runtime, creates an Agent whose header names `science`, and mounts the exact shipped preset through `ctx.agentPresets.mount(agentCtx, 'science')`. It does not duplicate the roster in a headless example or a test-only Cordis composition.

The Loader, shipped preset registry/mount, agent loop, Session store, system-prompt pipeline, tool execution, and model request remain real. The Web Vitest config does not mount `scripts/test-invariants.ts`; relational invariant evidence stays in its owning unit lanes and is neither part of this application snapshot nor a reason to add Host rows.

The runnable scenario sends one request and captures the Science persona, applicable project instructions, `science:environment` runtime-context message, exact tool schemas/roster, `get_science_state` result, and the ordering from `science/mode-bound` and `science/environment-bound` through `request/header`. It rejects Host paths and Runtime-only identity fields in model-visible output.

The existing browser lanes read the real shipped preset root. `apps/web/tests/agent-preset-selection.e2e.ts` and `apps/web/tests/agent-preset-authoring.e2e.ts` plus their `menu.expected.md` and `section.expected.md` ARIA goldens show the fifth built-in preset, localized copy, order, default retention, and disabled Science copy action. `apps/cli/tests/web-agent-presets.e2e.ts` separately proves exact Science/Standard roster isolation, fail-loud behavior without Runtime, a successful fake-Runtime Science request, and disposal isolation.

### Verification and closure

R4 source evidence at the repaired behavior candidate includes the copyability/API/client unit suite (378 tests, 17 files), the CLI e2e composition file (38 tests), the two Web browser lanes plus the Web snapshot (14 tests), the built-artifact lib-mode snapshot, a Node 24 Host build, the five artifact checks with the sandbox-blocked built-bin command repeated unchanged on the Host, `verify-cordis-config`, `doc-sync`, and lint. The final acceptance audit rejected the prior candidate because damaged or absent policy could fail open and because the Science tool README still described schemas as globally scoped. The repair makes broken rows non-copyable, requires valid shipped metadata, covers missing/malformed/wrongly typed shipped policy through the real CLI composition, removes the stale limitation, and regenerates affected catalogs. Final semantic and diff re-review found no remaining blocking or high-severity finding in the repaired scope. Historical repository-wide hygiene exceptions remain separate from this repair. The [dated R4 evidence record](../../../../docs/evidence/2026-08-16-dsh-science-v01-r4-science-preset.md) binds every result and exception to `cda69a9e5f6fb729c4699f70e06dc23745f0788f`.

Real Python and R Consumer acceptance against explicitly authorized existing Conda prefixes remains `NOT-RUN` for R4. Desktop, provider credentials, signing, publication, and release remain `NOT-RUN`.

### Supersession and lifecycle

R4 does not supersede the R1 Science Session, R2 Science Runtime, or R3 Science tools decisions. It consumes their public responsibilities and completes the accepted Science line with the first shipped application composition. The generic `copyable` preset-metadata mechanism extends the current preset authoring contract; the [copy-only authoring decision](../simplification/2026-08-08-copy-only-preset-authoring.md) remains independently useful and active.

The downstream Phase 3 preset commit is provenance from the excluded lineage and was not copied into the active tree. Project documentation must not call Science Mode release-ready until the settings/sidebar, chart/Outcome, Desktop, artifact, and release layers pass their own decisions and evidence; a deployment must still mount `@deepseek-ai/dsh-science-runtime` with a `science` profile before a Science session can complete a real request.

## Alternatives considered

**Cherry-pick or copy the downstream preset commit.** Rejected because `fae091e...` belongs to a failed whole-range candidate, omits R3's required `stateHistoryLimit`, uses a direct-assembly snapshot, and carries generated/documentation assumptions from another tree. Its rows were provenance to re-evaluate, not an implementation or evidence boundary.

**Mount Science Session and invariant companions in the Web Host.** Rejected because event admission already comes from the generated repository event set, the R3 Consumer replays the Session directly, and no R4 Web reader consumes the optional projection. Production relational checks and projection checkpoints require their own consumer, cost, and failure-policy decisions.

**Allow the generic copy flow to create `science-copy`.** Rejected because R1 persists the literal `presetId: 'science'` and R3 qualifies the literal Session header. A copy that mounts visible tools but rejects every Science operation violates the preset authoring promise that a copy is as loadable as its source. R4 marks Science non-copyable at metadata, service, API, and UI layers; broadening durable Science identity remains separate work.

**Put Runtime profiles or Conda discovery in the preset.** Rejected because the preset is mounted on the agent plane while `ctx.scienceRuntime`, existing prefix allowlists, process confinement, and machine paths belong to the Host deployment. A model-facing composition must not discover or mutate execution environments.

**Hide the preset whenever Runtime is absent.** Rejected because the current preset registry has no Host-capability eligibility predicate, and adding settings/sidebar availability state would cross into `SCI-SETTINGS-SIDEBAR`. R4 accepts deterministic discovery plus a first-use diagnostic that names the missing service or profile; a later product decision may add availability presentation without weakening Runtime ownership.

**Include charts and Outcome publication.** Rejected because the R0 dependency order requires an accepted preset plus a separate decision for model-visible result and renderer ownership. R4 supplies that prerequisite and stops before new durable producers or renderers.

**Use a headless example or direct prompt assembly as the application snapshot.** Rejected because the preset registry is shipped by the Web bundle and the existing Web scaffold already exercises that exact root. A parallel headless composition or direct assembly could pass without proving the shipped registry, browser application, request-context logging, request headers, or Session reconstruction.

**Make Science the default preset.** Rejected because R4 adds an opt-in capability whose Runtime is deployment-provided and may be unavailable. Changing the default would alter every new session and conflate source composition with deployment readiness.

## Consequences

R4 gives the Science line its first shipped application composition without importing downstream history. The preset root lists `science` as a system preset with display order `5` and the decided Chinese fallback metadata, while `standard` remains the composition and settings default. The Science preset supplies `profileId: science`, `modeRevision: science-v1`, `stateHistoryLimit: 8`, project `AGENTS.md` instructions, exactly the approved tool roster, and no process-global service or forbidden tool. The generic preset contract defaults healthy user presets to copyable, requires valid metadata for shipped presets, resolves every broken preset non-copyable, and honors a healthy preset's explicit false value. Science declares false; direct service/API copies fail with a source-specific diagnostic, and the Web authoring golden shows no enabled Science copy action. The shipped Web Host adds no invariants, invariant companions, or Science Session projection row, and generated known-event types remain the event-admission authority. It also added no Runtime row at R4; the base Host composition still adds none, but [R6](2026-08-17-dsh-science-v01-r6-settings-details.md) later mounts a settings-bound, intentionally unconfigured `@deepseek-ai/dsh-science-runtime/with-settings` row in the shipped Web bundle specifically. A missing Runtime service or `science` profile fails before any provider request, names the missing Host subject, and never falls back to another profile, Standard mode, or a discovered machine path. `apps/web/tests/science-preset.snapshot.ts` mounts the exact shipped preset and records a real model request whose persona, project instructions, runtime context, tools, result, and durable events are mutually reconstructable and contain no Host paths. The two existing Web browser lanes and ARIA goldens show five built-ins in order, localized Science copy, retained Standard default, and the disabled Science authoring action.

The preset is discoverable on Hosts that have no Science Runtime, so a user can select a mode whose first real request fails; R4 accepts that product tradeoff with a diagnostic naming the missing service or profile before a provider call and with no readiness claim. The generic copyability field changes preset, Host API, and client behavior together — unit, wire, and browser evidence all agree on it, closing the gap a UI-only or service-only check would leave. A manual filesystem clone can still bypass `agentPreset.copy` and produce an ineligible Science composition; mounting or first use retains R3's literal-identity diagnostic until a separate durable-identity decision supports derived Science ids. `science-v1` is durable Session identity, so an incidental string change would strand resumable Sessions under R3's deliberate mismatch rule; revision changes require a separate compatibility decision. The narrow roster gives up shell, mutation, delegation, Web search, and chart publication; adding one for convenience changes the product/security promise and requires explicit review rather than a YAML-only edit. R4 has no production projection consumer — adding `@deepseek-ai/dsh-science-session` later without a concrete Web read path would add checkpoint work and Host-wide event processing without an owning product behavior.

R4 closure changes only `SCI-PRESET`; charts/Outcome, settings/sidebar, Desktop, real-provider, publication, tag, push, and release remain outside the accepted claim, exactly as recorded in the R0-R3 overlay inventory.
