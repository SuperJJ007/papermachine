# Agent Note: Science artifacts — versioned figures carrying their provenance

Status: implemented

English | [中文](2026-08-18-science-artifacts.zh.md)

## Problem

Science version one already stores every chart as an immutable record with a contiguous per-chart version, but no product surface presents it that way. The transcript renders each `save_chart` result as a self-contained card, and the Details column renders one flat current-state summary. A person doing analysis produces many revisions of the same figure, and today has no way to see what changed between two of them, and no way to answer the question that decides whether a result can be defended: which code, which environment, and which conversation produced this figure?

The durable log already answers most of that question. `ScienceChartVersion` carries `runId`, `toolCallId`, `requestHeaderSeq`, `environmentRevision`, and `environmentFingerprint`; `ScienceRunIdentity` carries `codeSha256`, `scratchKey`, and the same call and request-header references. Three obstacles stand between that record and a usable provenance surface:

- **The client-safe projection strips the linkage.** `clientChart` and `clientRun` (`packages/science/science-session/src/projection-value.ts`) drop `toolCallId` and `requestHeaderSeq` as "authorizing request facts". Without them the browser holds a chart and a transcript with no way to join them.
- **No layer captures a package inventory.** `ScienceInterpreterIdentity` records `languageVersion`, `condaHistorySha256`, and `bindingFingerprint`. Nothing records which packages the environment actually contains, so an environment record cannot state what the analysis ran against.
- **A Details entry cannot contribute header controls, and a transcript row cannot open the Details column.** `DetailsPanel` owns a fixed title-and-close header, and `ToolCallViewProps` carries no `openDetailsView` — the capability exists only on `ConversationHeaderActionOwnerProps`.

## Decision

Name the concept the log already stores. A **Science artifact** is one logical chart, identified by `chartId`; an **artifact version** is one `ScienceChartVersion`. No new durable event and no new domain concept: the artifact is already in the log, contiguously versioned and immutable.

Every artifact version resolves a **provenance bundle** of four parts:

| Part | Source | Route |
|---|---|---|
| Code | `run_code` call arguments | chart `runId` → run `toolCallId` → transcript tool node |
| Execution log | `run_code` call result (stdout/stderr text, exit code) | same tool node; durable byte counts and truncation flags come from the projection |
| Conversation | the turn that issued the call | chart/run `toolCallId` and `requestHeaderSeq` |
| Environment | `science/environment-bound` at the chart's `environmentRevision` | projection, extended with the package inventory below (see "Environment history is single-revision" under Consequences) |

The split is deliberate and already correct: **durable Science events store identity and digests; the transcript stores text.** `codeSha256` is the durable anchor and the tool call is the copy that is rendered. Provenance therefore needs no new Host read route for code or logs — only the projection linkage that makes the join possible.

### Enabling changes (Host)

**Restore the linkage on the projection.** `ScienceClientChartVersion` and `ScienceClientRun` gain `toolCallId` and `requestHeaderSeq`. Both are session-log identities the browser already holds — transcript tool nodes are keyed by the same `CallId`, and `requestHeaderSeq` addresses a `request/header` event the client already receives. They are not the class of fact the projection filter exists to remove (Host paths, executables, full fingerprints, free-text failure), and the filter's current breadth makes provenance impossible. The `clientChart`/`clientRun` doc comments change with the fields.

`ScienceClientRunIdentity` also gains `codeSha256`, passed through whole rather than truncated to a preview. The provenance view's Code part (below) needs the durable digest as its anchor, and unlike `environmentFingerprint` a code digest carries no Host-infrastructure fact — it is a digest over source text the same transcript call already restates verbatim once resolved. `projection-schema.ts`'s run-identity validator gains the matching full-length hex check.

**Capture the package inventory.** `science-runtime/environment.ts` already runs confined, sandboxed probes against the configured prefix (`runProbe`, `probeArgv`, `confineProbe`) and discriminates them with `kind: 'version' | 'utf8'`. Add `'packages'`:

- Python: `python -m pip list --format=json` — reports what the interpreter itself sees, requiring nothing outside the prefix.
- R: `Rscript -e` over `installed.packages()[, c("Package", "Version")]` printed as TSV. **Base R only** — `jsonlite` is not guaranteed present in a user's environment, so the probe must not depend on it.

A new `SciencePackage { name, version }` list lands on `ScienceInterpreterIdentity` as `packages`, alongside `packagesSha256` (a stable digest over the sorted inventory) and `packagesTruncated`. Because identity facts are `Partial` on a non-`available` binding, a failed observation carries no inventory without a sentinel — the existing honest-capability record already has the right shape.

The inventory is bounded at the point where the complete retained value is known: a validated Runtime `Config` field caps the entry count, and a second caps total bytes; exceeding either sets `packagesTruncated` and keeps the digest over the complete pre-truncation inventory. The cap is deployment-varying (a genomics environment is not a teaching environment), so it is a `Config` field changeable from cordis.yml, not a `DEFAULT_*` constant.

A third bound governs the probe itself, before either retention cap applies: `PACKAGES_PROBE_MAX_BYTES` (8 MiB, `environment.ts`) caps the raw subprocess capture for the packages probe. Unlike the two retention caps, this one is fixed, not a `Config` field. It does not cleanly fit the "no hardcoded tunables" rule's reserved categories — protocol constant, external spec, security invariant — so the honest justification is precedent: it follows `MAX_OUTPUT_BYTES` in this package's `execution.ts`, the existing fixed ceiling on a subprocess capture that guards against a runaway child rather than expressing deployment policy. The two retention caps vary by deployment because how much inventory an operator wants kept is a genuine operational choice; the capture ceiling has no such axis — its only job is to bound what the raw subprocess can produce before parsing and truncation run, and it is set well above `MAX_PACKAGES_MAX_BYTES` (the highest configurable retention cap) so a probe transcript for any inventory within the configurable cap is never lossy at capture time, even with JSON/TSV formatting overhead. An operator who wants a smaller retained inventory still sets `packagesMaxBytes`; the capture ceiling is invisible to that choice.

`bindingFingerprint` keeps its current inputs. Folding the package digest into it would silently redefine what counts as the same binding and re-key existing drift behavior; `packagesSha256` is recorded separately so a future drift rule can consume it as an explicit decision.

The client projection passes `packages`, `packagesTruncated`, and a `packagesSha256` preview through unchanged — package names and versions carry no Host path, so `clientInterpreter` needs no new redaction.

**Open the two client seams.** `packages/client/ui-conversation` (PR2):

- Declare `conversation.details.header.actions`, a keyed list slot rendered by `DetailsPanel` between the title and its own close button, keyed by details-entry id so only the active entry's controls render. The panel keeps owning the close control; entries contribute their own buttons.
- Add `openDetailsView` to `ToolCallOwnerProps` — `ui-tool`'s `tool.call.toolview` owner share, not a `ui-conversation` type — so a transcript row can select a Details entry and open the column. The capability, the owner, and the store write are the ones `ConversationHeaderActionOwnerProps` already uses; they reach `ToolCallOwnerProps` by riding the existing render path, `ChatNodeOwnerProps` (`ui-conversation`) → `ChatView`/`ChatNodeSeat` → `ToolCallTree`'s per-call dispatch, the same route `openFile` and the trajectory `inspect` callback already take to reach a target neither `ui-tool` nor `ToolCallOwnerProps` owns. This is one more seat on an existing contract and route, not a new one — a `ui-conversation` client-service method was considered and rejected (below) because the per-session Details selection is slot-declared store state the render tree resolves per session; nothing outside that render path can reach the same live instance.

**Two more additive owner-share fields (PR3).** Neither existed when the two seams above were opened; both surfaced only once the artifact panel's header controls and the provenance tab needed a write path the note's original two seams did not cover:

- `DetailsHeaderActionOwnerProps` gains `openView: (id: string) => void`. `DetailsPanel` already declares `store: chatStore` for its own close control and its routed-entry dispatch, so exposing `actions.setView` to the header-actions owner share costs the shell nothing new — it is the one write a header control cannot reach any other way (switching the center-column `conversation.view` tab for "the selected X" without that control needing its own store seat). The artifact panel's "provenance" button is the first caller.
- `ConvViewOwnerProps` gains `inspectCall: (callId: CallId) => void` — the same one-shot inspect-and-reveal handoff chat's own tool rows already trigger (write the target call, switch to the trajectory view), generalized off `ConversationSession`'s own render site (which already computes it once per render, closing over its own `store: chatStore` share) so every `conversation.view` entry gets it, not only chat's descendant tool rows. `ChatViewInjected` drops its own private copy of the same closure; `ChatView.tsx` needs no change; the value now arrives through the owner share `PropsRuntime<'conversation.view'>` already merges in. The provenance tab's jump-to-transcript action is the first non-chat caller.

### The artifact panel — Details column

`ScienceDetailsView` shipped as a tabbed artifact viewer, not the gallery-and-version-rail dashboard this section originally proposed. A top tab strip holds one tab per opened logical chart, each with an in-panel toolbar (title, a version stepper across that chart's durable versions, provenance/download/maximize/close-tab controls) over the dispatched content. With no open tabs the panel shows a landing view — every logical chart's latest version, opening one opens its tab, plus the latest Outcome below it. The Environment strip and Runs list this section proposed as resident panel sections did not ship as resident sections at all; environment facts live only inside a selected artifact's provenance drill-in (below), scoped to that artifact's run. Selection is an open-tabs model (`selection-store.ts`), not the `{ chartId, version } | null` this section originally proposed. See [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.md) for the shipped design, its store invariant, and the alternatives it weighed.

### The provenance view — conversation view tab

Provenance did not ship as a separate `conversation.view` tab (id `science.provenance`) with the session-gated dynamic registration this section proposed. It shipped as an in-panel drill-in instead: the artifact toolbar's "Provenance" control switches the active tab's view to a breadcrumbed provenance view with four sub-tabs — Code, Execution log, Messages (renamed from "Conversation" in this proposal), and Environment — showing one section at a time. Each sub-tab resolves the same provenance part this section specified: the durable code digest alongside the transcript's argument text, execution log text plus the projection's durable byte counts and truncation flags, a jump-to-transcript action (now through `DetailsViewOwnerProps.inspectCall`, the owner share for `conversation.details.view` entries, rather than the `ConvViewOwnerProps.inspectCall` this section originally proposed for a `conversation.view` entry — that field still exists and still serves ordinary `conversation.view` entries, but Science is no longer one), and the environment revision as JSON with the same superseded-revision fallback described here. See [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.md) for the full decision.

### The transcript row

`ScienceChartRow` stops being a full card and becomes navigation: a compact row with a small thumbnail, `logicalName`, `v{n}`, and title. Activating it selects that artifact version in the ui-science store and calls `openDetailsView('science')`. A hover-revealed control on the thumbnail opens the lightbox directly, so full-screen viewing stays one action. The running, failed, interrupted, and unparseable fallbacks keep their current text behavior.

### Files this touches

- `packages/science/science-session/src/` — `types.ts` (client chart/run linkage fields, `codeSha256` on `ScienceClientRunIdentity`, `SciencePackage`, inventory fields), `projection-value.ts` (`clientChart`, `clientRun`, `clientInterpreter`), `projection-schema.ts` (linkage and `codeSha256` validation), `fold.ts` decoders, `domain.ts` event payload.
- `packages/science/science-runtime/src/` — `environment.ts` (the `packages` probe and its bounds), `config.ts` (the two cap fields).
- `packages/client/ui-conversation/src/client/` — `contract/slots.ts` (PR2's `conversation.details.header.actions` keyed slot and `ChatNodeOwnerProps`/`ChatViewInjected.openDetailsView`; PR3 additive fields `DetailsHeaderActionOwnerProps.openView` and `ConvViewOwnerProps.inspectCall`), `skeleton/DetailsPanel.tsx`, `skeleton/DetailsPanel.module.css`, `skeleton/ConversationSession.tsx` (PR3: the `inspectCall` closure moves here from `ChatViewInjected`), `apply.ts`, `chat/ChatView.tsx`, `chat/ChatNodeSeat.tsx`.
- `packages/client/ui-tool/src/client/` — `contract/slots.ts` (`ToolCallOwnerProps.openDetailsView`), `tool/ToolCallTree.tsx`.
- `packages/client/ui-science/src/client/` — `ScienceDetailsView.tsx` (artifact panel), `ScienceChartRow.tsx` (compact row), new `ScienceArtifactHeaderActions.tsx` (the panel's two header controls), new `ScienceProvenanceView.tsx`, new `selection-store.ts`, `index.ts` registrations (including the session-list-driven provenance-tab gate), `locales.ts`.
- READMEs for every package above, in the same change.

## Alternatives considered

**Introduce a `science/artifact-*` event family.** Rejected: `ScienceChartVersion` already is the artifact version — immutable, contiguously versioned, and attachment-bearing. A parallel family would duplicate identity, split replay, and force a rule about which record wins.

**Capture the package inventory per run rather than per environment binding.** Rejected: the inventory is a property of the binding, runs are frequent and short, and per-run capture would multiply durable bytes and probe latency for identical data. The cost is that a mid-session install is invisible until the next binding; `condaHistorySha256` already catches conda-level mutation at that point.

**Use `conda list --json` to get build strings.** Rejected: it requires locating a conda executable outside the configured prefix, which adds an external dependency and a new sandbox surface to a probe path that is currently self-contained. `pip list` and `installed.packages()` report what the interpreter itself sees. The cost is that inventories carry name and version but no build string.

**Use `jsonlite` in the R probe.** Rejected: it is an ordinary CRAN package that a user's environment may not have, and a provenance probe that fails on a valid environment is worse than a TSV parse.

**Make the probe capture ceiling a third `Config` field.** Rejected: the two retention caps are deployment-varying because operators genuinely want different amounts of inventory kept; the capture ceiling has no comparable axis — it only has to stay safely above the highest configurable retention cap so a valid inventory is never truncated at capture time by formatting overhead. Exposing it as `Config` would offer a knob with no legitimate value outside "large enough to never truncate," which is not the configurability a `Config` field is for; it would be a `DEFAULT_*` constant with an approval process attached. `MAX_OUTPUT_BYTES` already fixes the analogous ceiling for run output; sizing this one the same way keeps the two capture ceilings consistent.

**Fold `packagesSha256` into `bindingFingerprint`.** Rejected for now: it would silently change what "the same binding" means and re-key drift detection as a side effect of adding a capture. Recording the digest separately keeps that a future explicit decision.

**Put artifact selection in `ChatStoreState`.** Rejected: it is Science domain viewing state that only ui-science reads, and ui-conversation owns that store for state its own skeleton dispatches.

**Expose details-opening on `ui-conversation`'s client service (`ctx.conversation`) instead of `ToolCallOwnerProps`.** Rejected: the active Details entry is per-session state in the slot-declared `chatStore`, and the slots engine resolves one live instance per (store handle, session) pair inside its own registry, handed to a component only through the `store`/`actions` share a slot registration receives at render time. `ConversationController` is a root-scoped singleton outside that render path; reaching the same live instance from it would mean adding a second, service-side store-resolution path that duplicates what the registry already owns, to open one seat only `ui-tool`'s render path needs. `openFile` and the trajectory `inspect` callback already ride the `ChatNodeOwnerProps` → `ToolCallOwnerProps` route for the same reason: their target (workspace open, trajectory view) is owned elsewhere, and the owner-props chain is the sanctioned way to reach it without a cross-package value import.

**Render provenance in the Details column instead of a view tab.** Rejected: code, execution logs, and an environment JSON block are wide, and the Details column is clamped to 520px (`DETAILS_MAX`) and auto-closes under concession. The center column is the only surface with room.

**Keep the transcript row as a full chart card.** Rejected: once the panel renders the artifact with its versions, the card is a duplicate that pushes the conversation apart. The row's remaining job is navigation.

**Gate the provenance tab by rendering null for a non-Science session, matching `ScienceHeaderAction`'s own pattern exactly.** Rejected once the render tree was in hand: `conversation.session.header.actions` is a list of independent controls, each free to render nothing on its own account, so a null-rendering header action genuinely leaves no trace. `conversation.view` is different — its tab row is projected from `views.list()`, a static registration ledger read at the render site (`ConversationSessionHeader`), before any entry's own component runs; a null-rendering entry still owns a ledger row, which still produces a clickable, labeled, empty tab for every non-Science session. "Absent" in the acceptance criteria means the ledger row itself is gone. Extending `views.list()`/the registration options with a generic per-session visibility predicate was also considered and rejected: it is a `ui-slots`/`ui-conversation` framework change serving exactly one current caller, where package-local dynamic registration (`ctx.sessions.list.subscribe`, symmetric with this file's other `ctx.effect`-scoped registrations) reaches the same outcome without widening either package's public surface.

**Make the new inventory fields optional so existing logs replay.** Rejected under the pre-release stance: an optional durable field would carry a compatibility promise this repository explicitly does not make, and a required field fails loud at decode instead of silently producing an environment record that cannot state its packages.

## Consequences

- A chart's client projection carries `toolCallId` and `requestHeaderSeq`, and the browser resolves that chart's `run_code` call from the conversation snapshot with no additional Host route.
- Binding an environment records a package inventory per available interpreter, with name and version per entry, a digest over the complete sorted inventory, and a truncation flag; an unavailable interpreter records none.
- Both inventory caps are validated `Config` fields settable from cordis.yml; an inventory exceeding either cap is truncated, flagged, and still digested over the complete pre-truncation value.
- `bindingFingerprint` is byte-identical to what the same environment produced before this change.
- The Details column, redesigned as the tabbed artifact viewer described above rather than the gallery-and-version-rail this section originally proposed, lets a person open any logical chart in its own tab and step through every durable version of it through the toolbar's version stepper.
- The keyed `conversation.details.header.actions` slot this note added to `ui-conversation` remains a general framework capability, but Science's own registration into it — the panel's original provenance/expand header controls — was later deleted in favor of controls inside the artifact toolbar itself; the panel's own close control is unchanged.
- Activating a transcript chart row opens or activates that chart's tab at the exact version the row names; the thumbnail's hover control opens the lightbox without opening the column.
- The provenance bundle — code, execution log, conversation turn, and environment JSON for a selected version — renders as the in-panel drill-in described above rather than the separate `conversation.view` tab this section originally proposed, with a distinct documented state for each part that is individually unavailable (including a superseded environment revision the projection no longer retains) and for a run outside the loaded conversation window.
- The artifact viewer and its provenance drill-in are absent from a Standard or custom non-Science session, because the `conversation.details.view` entry itself does not register outside the `science` preset.
- Disposing the ui-science and ui-conversation fibers removes every registration this note and its viewer-panel redesign added.
- **Existing Science session logs stopped replaying.** The required inventory field means a `science/environment-bound` payload written before this change fails its decoder. The pre-release stance sanctions this (backends reject old on-disk formats); no migration was written, and every retained fixture and recorded snapshot containing that event was re-recorded in the same change.
- **Probe cost lands on environment binding.** `installed.packages()` over a large R library is not instant, and binding is on the path to a session's first run. The probe runs under the existing confinement and timeout, so the failure mode is a bounded delay or an unavailable binding, not a hang.
- **A truncated inventory is a weaker provenance record.** The digest still covers the complete inventory, so truncation is detectable, but a capped list cannot be replayed into an environment.
- **Code and execution log depend on loaded conversation history.** They come from the transcript, which the client loads as a window (`loadOlder`). An artifact whose run predates the loaded window renders unavailable until more history loads; the durable digest and byte counts remain visible so the state is legible rather than empty.
- **Environment history is single-revision.** `ScienceProjection.environment` (and its client projection) retains only the latest binding, not one per revision, so the provenance drill-in's Environment part cannot show the exact environment an older artifact ran under once the binding has moved on — it reports the retained revision number and the run's own fingerprint preview instead of the JSON block. Per-revision environment history remains a larger, separately-scoped change (the durable events already carry each revision; the projection would need to retain more than the latest).
- **The `SessionEventMap` payload change reached both SDKs.** The TypeScript and Python SDK expected outputs and the keyless snapshots (`apps/web/tests/snapshots/science-preset`, `examples/headless-agent/tests/snapshots/science-tools`) were updated in the same change; `pnpm run test` covers none of them.
