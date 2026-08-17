# Agent Note: DSH Science v0.1 R6 settings and Details

Status: proposed

English | [中文](2026-08-17-dsh-science-v01-r6-settings-details.zh.md)

## Problem

The Science line has accepted Session, Runtime, model-facing tools, preset, and durable chart/Outcome layers. The shipped Web application still has no user-facing way to configure the `science` Runtime profile, see whether that profile is configured, or inspect the current Science Session outside individual tool occurrences. Selecting the Science preset can therefore lead to a first-use Runtime diagnostic without a setup path, and a completed analysis has no current-state side panel.

R6 must close only the `SCI-SETTINGS-SIDEBAR` inventory row. It must preserve Runtime ownership of existing Conda prefixes, keep absolute Host paths out of model and browser-readable state, reuse the durable `science` Session projection, and extend the existing settings and Details plugin points instead of replacing their shells. R6 must not reopen an accepted R5 decision or turn settings into Conda discovery, package installation, environment mutation, Desktop, or release work.

## Proposal

Implement R6 over the R5 closure head `16f5ce76abf8483c42bf02214cf15d82a2300b9c` — the accepted product candidate `69045ba510f90380f5ed83ca1acbd955e7178fbf` plus its implemented Note and dated evidence — as three separately accepted checkpoints: Runtime settings ownership, generic Details routing, and the Science settings/Details product surface. The Web bundle will mount an intentionally unconfigured Science Runtime, expose a Science settings card in the existing Plugins settings section for the shipped `science` profile, and add a Science entry to the existing right-side Details column. Headless and custom deployments will continue to supply Runtime composition explicitly.

R6 will change setup, not execution authority. Users may name existing absolute Python and R Conda prefixes for the fixed `science` profile and then restart the Host. The Runtime will continue to observe, confine, and execute those prefixes through the R2 rules; it will not discover, create, clone, solve, install into, update, repair, or delete an environment. The Science Details entry will be read-only and derive its mode, environment summary, runs, charts, and latest Outcome from the accepted client-safe Session projection.

### Planning identity and start conditions

| Subject | Identity or rule | R6 use |
|---|---|---|
| Accepted product base | [R5 closure](../../../../docs/evidence/2026-08-17-dsh-science-v01-r5-charts-outcome.md) head `16f5ce76abf8483c42bf02214cf15d82a2300b9c`, binding product candidate `69045ba510f90380f5ed83ca1acbd955e7178fbf`, plus the separately accepted R5 module-graph correction `58aee8561ca665fc7056f2dc013e7012aafc4da5` | The base R6a and R6b started from |
| R6c implementation base | `24971d5f14c8b9dc692658a0bb1cab599a4ed526` — the post-[rebaseline](../../implemented/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md) head whose independent review accepted R6a, R6b, and the rebaseline together | Sole R6c implementation base; R6a's and R6b's pre-rebaseline SHAs are history, not start conditions |
| R6 inventory row | [`SCI-SETTINGS-SIDEBAR`](../../../../docs/evidence/2026-08-15-dsh-science-v01-r0-rc5-baseline-closure.md) | Sole product delta |
| Runtime authority | [R2 Science Runtime](../../implemented/feature/2026-08-15-dsh-science-v01-r2-science-runtime.md) | Existing-prefix observation, execution, confinement, leases, and real Python/R acceptance remain owned there |
| Shipped composition | [R4 Science preset](../../implemented/feature/2026-08-16-dsh-science-v01-r4-science-preset.md) plus the accepted R5 composition | Preserve the fixed `science` preset identity and add only the R6 Host/Client rows |
| R5 dependency | [R5 charts and Outcome](../../implemented/feature/2026-08-16-dsh-science-v01-r5-charts-outcome.md) | Durable chart/Outcome semantics, `ui-science`, and the client-safe projection R6 builds on |
| Source base | [rc.7 rebaseline](../../implemented/process/2026-08-17-dsh-science-v01-rc7-rebaseline.md), upstream `4366528a38` ([plugin-owned settings surface](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md)) | Registering a settings namespace now exposes it; `settings.plugin.item` is a slot keyed by namespace. R6c's product surface targets this mechanism, not an ApiProxy allowlist entry |
| Downstream source | The upstream commit named in the Source base row | Not a fresh RC5-line product decision: R6c's settings card design follows the generic mechanism upstream shipped, rather than inventing an ApiProxy exposure path this line would have to maintain alone |

R6-0 is a hard stop, not an implementation checkpoint. Before changing source, confirm on the exact starting tree that the worktree is clean, that the R5 Note is under `implemented/feature`, and that the dated R5 evidence binds the same head this Note names. Re-inspect the wire projection at that head and reject the base if it exposes `configuredPrefix`, `canonicalPrefix`, `executable`, another absolute Host path, or an unredacted full environment fingerprint; R5 ships a client-safe projection that carries a twelve-character fingerprint preview and no prefix, executable, or digest field, so this check confirms rather than discovers. Any later privacy correction belongs to its own accepted candidate before R6 is rebased.

### Runtime settings ownership

Add a `@deepseek-ai/dsh-science-runtime/with-settings` entry that provides the same service over the same `Config` and additionally treats the existing `profiles` configuration as the composition `base` of a `science-runtime` user-settings namespace. The namespace will contain only the profile map; `dshHome`, execution timeout, and artifact-diagnostic bounds remain Cordis configuration because R6 has no product need to edit them. The root entry keeps its current behavior and never reads settings.

The settings capability is a declared Cordis injection of that entry, not something the Runtime probes for at load. The Loader creates sibling entries concurrently, so "is a settings provider present right now" answers which module finished importing first rather than what the composition contains; a deployment that mounts the settings-bound entry without a settings provider leaves it PENDING on the unmet injection instead of silently resolving profiles from the Cordis map alone.

The settings schema will accept an empty profile map as the intentional unconfigured state. Every declared profile still uses the R2 safe-id grammar, contains at least one of `pythonPrefix` or `rPrefix`, and uses absolute paths. Invalid declared profiles fail registration or a settings write. A missing requested profile continues to fail before provider I/O and before any Science event is appended; it never falls back to another profile or a discovered path.

That entry will register the namespace with `applies: 'restart'`, capture the resolved profile map once during plugin load, and not watch it. Cordis entry configuration remains the lower-precedence deployment base, while the user document may override or remove fields through the existing settings revision and mutation rules. A successful write changes the next Host start only; it cannot swap an environment underneath a live Session.

`pythonPrefix` and `rPrefix` are write-only secrets on browser-facing settings descriptors. The Client may learn which profile/language fields are configured and whether a user override exists, but no settings response, forwarded event, diagnostic, snapshot, or projection may carry the path value. Host logs and model-visible text also remain path-free.

The Web bundle will mount `@deepseek-ai/dsh-science-runtime/with-settings` alongside the base settings, subprocess, sandbox, attachment, and Science Session services with `profiles: {}`; Cordis, not entry order, sequences it after the settings provider. This changes the default Web failure from “Runtime service missing” to the more actionable “science profile missing” until setup and restart complete. CLI/headless bundles will not gain this row; their deployment overlay remains authoritative.

### Generic Details routing

Extend `@deepseek-ai/dsh-client-ui-conversation` with a list slot named `conversation.details.view`. The existing tool-call body becomes the built-in `tool` entry, retaining its current input/output rendering and `conversation.details.tool` child seat. The Details shell continues to own column geometry, close behavior, title chrome, mounted-on-collapse lifecycle, and fallback behavior.

Add a `detailsView` id to the per-Session conversation store and an action that selects it. Tool-row activation selects `tool` and the addressed call before opening the column. The session-header action owner receives an `openDetailsView(id)` callback that selects a registered entry and opens the same column. An absent, removed, or stale id falls back to `tool`; changing Sessions keeps the existing AppFrame behavior of closing the column.

The Details shell will derive labels and ordered entries from the slot registry, subscribe to registry/locale changes, and render only the selected entry. Registrations remain effects; unloading a domain entry removes its label and body and leaves the built-in tool entry usable. No domain package may occupy the top-level `details` slot or import the Details shell implementation.

Title text stays the one exception the shell resolves itself rather than reading purely off the registry: while the built-in `tool` entry is active, the shell keeps computing the selected call's own name (falling back to the selection's carried tool name, then the generic label) exactly as it did before this seat existed, because a per-session store selection cannot express a registration-time label; every other entry's title is its registered label. A future entry that wants a live per-selection title carries that need through its own selection state instead of the shell acquiring more built-in awareness.

### Science settings and Details product surface

R6a needs no redesign from the rc.7 rebaseline: `installSettingsSection` already existed at rc.5, and rc.7 does not change the settings seam itself, so the `with-settings` entry with a declared `settings` injection stands as shipped.

Expand `@deepseek-ai/dsh-client-ui-science` from R5 transcript rows into the owner of the Science settings card, Science header action, and Science Details entry. The package will register one **keyed** `settings.plugin.item` card under key `science-runtime` — the namespace [R6a](#runtime-settings-ownership) registers, not a package or product id — one `conversation.session.header.actions` entry, and one `conversation.details.view` entry with id `science`; it will retain the R5 `save_chart` and `publish_outcome` toolview registrations. Keying on the namespace means the card needs no `settings.section` page, no navigation row, and no Host change to appear: the shipped Web bundle already mounts both `ui-science` and `ui-settings-plugins` ([`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml)), the Plugins section's `configurable` tab already dispatches one slot key per namespace the Host serves, and a deployment that does not mount the `with-settings` Runtime entry sees no trace of the card, matching the section's existing empty-state behavior. R6c still adds the host-plane `@deepseek-ai/dsh-science-runtime/with-settings` row to the default Web bundle; that row is what makes the namespace present for the tab to dispatch.

The card binds the `science-runtime` namespace through `ctx.settingsScope.bind({ namespace: 'science-runtime' })` and edits only `profiles.science.pythonPrefix` and `profiles.science.rPrefix`, because the shipped preset is the only current product Consumer and fixes `profileId: science`. It will show loading, namespace-absent, unconfigured, configured, saving, stale-revision, validation-failure, saved-restart-required, and reset-to-composition states. Blank replacement inputs are no-ops; an explicit remove-user-profile action unsets `profiles.science`, which returns to unconfigured when no composition base exists and otherwise reveals that base. Other deployment profile ids remain file/configuration concerns and are not a generic profile manager in R6.

`SettingsScopeController.set`/`unset` (`packages/client/ui-settings/src/client/settings-scope.ts`) currently write only a single path segment — `set(field, value)` issues `{ op: 'set', path: [field], value }` — while the fields R6c edits are two segments deep (`profiles.science.pythonPrefix`). The wire operation already carries `path: string[]` at any depth, and `SettingsNamespaceView.secrets[].path` is already an array, so nothing on the Host or wire needs to change; only the browser-side `SettingsScope` contract and its `SettingsScopeController` implementation need a path-addressed `set`/`unset`. Writing the whole `profiles` field instead of one nested path is not an option: `profiles` is a `dict` keyed by every profile id a deployment declares, the browser only ever receives the `science-runtime` namespace's redacted view, and a whole-field write would silently erase every other profile's secret values the card never saw. This is a small, generic `ui-settings` change (a reasonable candidate to propose upstream, since nothing about path-addressed writes is Science-specific), not a Science-owned one; R6c depends on it landing first.

The bundle-purity gate forbids the Science card from value-importing `ui-settings-plugins`' card chrome or its staged-form model, so the card owns its own staging and revision fencing rather than reusing the Plugins section's. `packages/client/ui-science/package.json`'s `dsh.client.inject` must add `@deepseek-ai/dsh-client-ui-settings-plugins` to reach the keyed slot's type-only declaration, matching the [settings-card cookbook](../../../../docs/cookbook/adding-a-settings-card.md)'s pattern.

The browser never echoes a stored prefix. A configured field renders a neutral “configured” state; replacing it requires a new absolute path, a blank field changes nothing, and explicit reset removes only the user-layer `science` profile so a composition base can reappear. Settings conflicts reload the current descriptor before another write. R6 will not add a browser filesystem picker, path discovery, prefix probing, package inventory, or live apply button.

The Science header action appears only when the current Session summary names the built-in `science` preset. Activating it opens the `science` Details entry. The entry reads the `science` Session projection and renders a client-safe environment summary, ordered run status/history, logical charts with their latest accepted versions, and the latest Outcome with evidence references. It reuses R5 attachment loading for chart thumbnails and does not create another projection, chart store, Outcome editor, or attachment cache.

Before the first Science event, the Details entry shows the selected preset and an unbound state. Missing projection support, unavailable attachments, failed Runtime binding, no runs, no charts, and no Outcome each have distinct accessible text. Standard and custom non-Science Sessions receive no Science header action and no automatic panel opening. The UI never treats configured prefixes as validated; interpreter capability comes only from a durable environment binding after Host restart and use.

### Checkpoints and executable sequence

**R6a — Runtime settings ownership.** Start from the accepted R5 head. Add the `with-settings` entry and its `science-runtime` namespace, intentional empty configuration, restart snapshot semantics, secret-path redaction, focused Runtime/settings tests, Loader composition covering both module-import orders, and current R2 Runtime documentation. Independently review and accept the exact R6a head before R6b starts. Do not add the shipped Web Runtime row or Client UI in this checkpoint.

**R6b — Generic Details routing.** Start from the accepted R6a head. Add `conversation.details.view`, the built-in `tool` entry, per-Session selection, header-owner opening callback, stale-entry fallback, HMR disposal coverage, and current `ui-conversation` documentation. Independently review and accept the exact R6b head before R6c starts. No Science-specific component belongs in this checkpoint.

**R6c — Science product composition and closure.** Start from the accepted R6c implementation base named in the identity table. Add the Science settings card/header action/Details entry, the default Web Runtime row, package metadata and invariants, assembled keyless browser coverage, accessibility checks, packed Web evidence, real Python/R Runtime acceptance, current documentation, the implemented rewrite of this Note, and a dated R6 evidence triplet. Final review covers the exact R5 base through R6c head and stops on any source, privacy, browser, packed, or real-runtime failure.

Every checkpoint records exact base/head identities and reruns affected evidence after any SHA change. A later checkpoint may not repair an earlier accepted checkpoint silently; the owner returns the fix to that checkpoint, obtains a new accepted head, and then rebases the later work.

### Documentation and evidence

Implementation will update the Runtime, `ui-conversation`, `ui-science`, settings, Science subsystem, package-group, and Web composition owners; their Chinese pairs; affected generated package/config/capability/module references; and browser snapshot expectations. It will update the still-active R2, R4, and accepted R5 Agent Notes only where R6 changes their current facts, without copying R6 rationale into them.

Volatile SHAs, commands, platform versions, real prefix identities, browser channels, and pass/fail results belong only in the dated R6 evidence triplet. Source checks, built/packed Web evidence, real Python/R acceptance, Desktop, signing, notarization, publication, and release remain separate rows; R6 source or packed-Web success cannot promote an unrun layer.

## Alternatives considered

**Leave Runtime setup in Cordis files and add only a read-only status page.** Rejected because the shipped Web application would still expose a selectable Science preset without a product setup path. The settings seam already supports composition base plus user override and explicit restart timing, so R6 uses it without taking over execution.

**Bind the namespace on one Runtime entry that checks for a settings service at load.** Rejected because the Cordis Loader creates sibling entries concurrently, so that check reports which module finished importing first, not what the composition declares. Whenever the settings provider's module landed second the namespace went unregistered and the stored profile was silently ignored — the exact restart the user performed to apply it — and cordis.yml entry order did not repair it. A declared injection makes Cordis sequence the two and turns a missing provider into a visible unmet dependency.

**Apply prefix changes live.** Rejected because a live settings write could change profile resolution between environment binding and later runs, or require migrating exact-Session reservations and scratch ownership. Restart-only resolution gives one immutable Runtime configuration to each Host lifecycle.

**Discover or manage Conda environments.** Rejected because discovery, create/clone/install/update/repair/delete, solver output, mutation locks, approval, rollback, quotas, and cleanup form a separate capability. R6 accepts explicit existing prefixes only.

**Return stored prefix paths to the browser.** Rejected because setup status and replacement do not require disclosing an absolute Host path. Secret-path descriptors preserve write and reset operations while keeping browser snapshots and forwarded events path-free.

**Let `ui-science` replace the top-level `details` slot.** Rejected because it would remove tool-call Details and make one optional domain own generic column chrome. R6 adds a domain entry behind a conversation-owned routing slot.

**Render Science as another center-column conversation tab.** Rejected because charts and Outcomes already remain in the transcript, while R6 needs a compact current-state surface that can stay beside the conversation. The existing Details column provides that relationship without duplicating the transcript.

**Fold R5 repair into R6.** Rejected because R6 depends on accepted R5 durable chart/Outcome and client-projection semantics. Mixing predecessor repair into R6 would erase the exact accepted base and make R6 evidence unable to distinguish the two inventory rows; a defect found in R5 returns to its own candidate.

## Supersession and lifecycle

This proposal does not supersede a current decision while unimplemented. If accepted, it amends the R2 configuration facts to include the restart-only user-settings layer and intentional empty Web state, amends R4/R5 composition facts to include the default Web Runtime and Science Details consumers, and leaves their execution, preset, chart, Outcome, and privacy rationale active. The scoped Agent Note audit found no implemented note eligible for archive, no obsolete proposal to reject, and no rejected guardrail to delete.

When R6 is accepted, this triplet moves to `implemented/feature`, `## Proposal` becomes a present-tense `## Decision`, execution plans become shipped verification facts, and the dated evidence triplet binds the exact final SHA and every `NOT-RUN` layer.

## Acceptance criteria

- R6 starts only from the clean R5 closure head `16f5ce76abf8483c42bf02214cf15d82a2300b9c`, whose implemented Note, dated evidence, and browser-safe projection agree; any later R5 correction is accepted separately first. Its one such correction, `58aee8561ca665fc7056f2dc013e7012aafc4da5`, regenerates the module graph R5 left stale and records the miss in the R5 evidence.
- The Web bundle mounts one intentionally unconfigured settings-bound Science Runtime; its settings card can create or replace the fixed `science` profile and explicitly remove/reset its user override through revision-checked writes, and every successful change is labeled restart-required.
- The settings-bound entry resolves the same stored profile whichever of it and the settings provider finishes importing first, proven by a real Loader composition that delays each module in turn; mounting it without a settings provider leaves it PENDING rather than resolving from the Cordis map.
- Runtime configuration is immutable for one Host lifecycle; empty is an explicit unconfigured state, malformed profiles fail loud, a missing `science` profile fails before provider I/O, and no alternate or discovered prefix is selected.
- Absolute prefix and executable paths are absent from settings reads/events, Session projections, snapshots, diagnostics, model-visible output, and browser text. Because registering the `science-runtime` namespace now serves it by default rather than gating it behind an ApiProxy allowlist, the negative tests target the settings seam's `role('secret')` redaction on the served namespace and the card's own display/staging path, not an exposure boundary. `scienceRuntimeProfilesSchema`'s `pythonPrefix`/`rPrefix` carry no default and sit under a `dict`, both of which the redactor already handles; the redactor's own deferred gap for a secret reachable only through a union, intersection, or transform (recorded in the [plugin-owned settings surface note](../../implemented/architecture/2026-08-12-plugin-owned-settings-surface.md#consequences)) means serving every namespace widens that gap's blast radius from audited schemas to any registered one, so the sentinel-path negative tests stay in scope even though no allowlist decides exposure anymore. Focused negative tests use recognizable sentinel paths and fail if any crosses those outputs.
- The generic Details slot retains tool-call behavior, selects domain entries by id, survives locale updates, falls back after stale/HMR removal, proves disposal, and closes on Session change as before.
- Only built-in Science Sessions show the Science header action. The Science Details entry renders unbound, environment, run, chart, attachment-failure, and Outcome states from the accepted projection without adding another state authority.
- Focused Runtime/settings, `ui-conversation`, `ui-science`, ApiProxy/settings-redaction, Loader, application browser, accessibility, and snapshot tests pass with owning changed-file coverage. `typecheck`, `build`, `hygiene`, `doc-sync`, `lint`, `git diff --check`, built/packed Web verification, and the exact final change-scope report pass on the recorded head.
- Real Conda Python and R acceptance both report machine-readable PASS on the exact final SHA using an isolated non-`/tmp` mode-0700 DSH home; fake-prefix tests do not substitute. Desktop, signing, notarization, publication, tag, push, PR, and release remain `NOT-RUN` unless separately authorized and evidenced.
- Final independent review receives the exact R5 base, R6 head, this scope, command evidence, privacy sentinels, and protected-worktree snapshot, reproduces the critical checks, and reports no unresolved high-severity finding before the Note moves to implemented.

## Risks

An empty Runtime row makes the service present before it is usable. R6 accepts that state only because the settings card names the missing `science` profile and the first model-facing use still fails before provider I/O; no UI may label the Runtime ready until a durable binding reports capability.

Restart-only settings can surprise a user who expects an immediate change. The page must retain a visible restart-required state after save and must not refresh a live Session into claiming the new prefix is active.

Write-only path fields reduce disclosure but prevent visual confirmation of the stored absolute path. R6 favors Host privacy and provides configured/user-override/reset state; a future native Desktop picker may improve setup without weakening redaction.

The right Details column becomes a shared routed surface. The generic checkpoint must preserve the tool fallback and HMR behavior independently before Science registers an entry, or an optional domain unload could strand ordinary tool inspection.

Real Python/R acceptance proves the configured interpreters and Runtime lifecycle, not plotting-library availability, scientific correctness, Desktop packaging, installer behavior, signing, notarization, or release readiness.
