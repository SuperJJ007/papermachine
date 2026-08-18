# Agent Note: Science artifacts — versioned figures carrying their provenance

Status: proposed

English | [中文](2026-08-18-science-artifacts.zh.md)

## Problem

Science version one already stores every chart as an immutable record with a contiguous per-chart version, but no product surface presents it that way. The transcript renders each `save_chart` result as a self-contained card, and the Details column renders one flat current-state summary. A person doing analysis produces many revisions of the same figure, and today has no way to see what changed between two of them, and no way to answer the question that decides whether a result can be defended: which code, which environment, and which conversation produced this figure?

The durable log already answers most of that question. `ScienceChartVersion` carries `runId`, `toolCallId`, `requestHeaderSeq`, `environmentRevision`, and `environmentFingerprint`; `ScienceRunIdentity` carries `codeSha256`, `scratchKey`, and the same call and request-header references. Three obstacles stand between that record and a usable provenance surface:

- **The client-safe projection strips the linkage.** `clientChart` and `clientRun` (`packages/science/science-session/src/projection-value.ts`) drop `toolCallId` and `requestHeaderSeq` as "authorizing request facts". Without them the browser holds a chart and a transcript with no way to join them.
- **No layer captures a package inventory.** `ScienceInterpreterIdentity` records `languageVersion`, `condaHistorySha256`, and `bindingFingerprint`. Nothing records which packages the environment actually contains, so an environment record cannot state what the analysis ran against.
- **A Details entry cannot contribute header controls, and a transcript row cannot open the Details column.** `DetailsPanel` owns a fixed title-and-close header, and `ToolCallViewProps` carries no `openDetailsView` — the capability exists only on `ConversationHeaderActionOwnerProps`.

## Proposal

Name the concept the log already stores. A **Science artifact** is one logical chart, identified by `chartId`; an **artifact version** is one `ScienceChartVersion`. No new durable event and no new domain concept: the artifact is already in the log, contiguously versioned and immutable.

Every artifact version resolves a **provenance bundle** of four parts:

| Part | Source | Route |
|---|---|---|
| Code | `run_code` call arguments | chart `runId` → run `toolCallId` → transcript tool node |
| Execution log | `run_code` call result (stdout/stderr text, exit code) | same tool node; durable byte counts and truncation flags come from the projection |
| Conversation | the turn that issued the call | chart/run `toolCallId` and `requestHeaderSeq` |
| Environment | `science/environment-bound` at the chart's `environmentRevision` | projection, extended with the package inventory below |

The split is deliberate and already correct: **durable Science events store identity and digests; the transcript stores text.** `codeSha256` is the durable anchor and the tool call is the copy that is rendered. Provenance therefore needs no new Host read route for code or logs — only the projection linkage that makes the join possible.

### Enabling changes (Host)

**Restore the linkage on the projection.** `ScienceClientChartVersion` and `ScienceClientRun` gain `toolCallId` and `requestHeaderSeq`. Both are session-log identities the browser already holds — transcript tool nodes are keyed by the same `CallId`, and `requestHeaderSeq` addresses a `request/header` event the client already receives. They are not the class of fact the projection filter exists to remove (Host paths, executables, full fingerprints, free-text failure), and the filter's current breadth makes provenance impossible. The `clientChart`/`clientRun` doc comments change with the fields.

**Capture the package inventory.** `science-runtime/environment.ts` already runs confined, sandboxed probes against the configured prefix (`runProbe`, `probeArgv`, `confineProbe`) and discriminates them with `kind: 'version' | 'utf8'`. Add `'packages'`:

- Python: `python -m pip list --format=json` — reports what the interpreter itself sees, requiring nothing outside the prefix.
- R: `Rscript -e` over `installed.packages()[, c("Package", "Version")]` printed as TSV. **Base R only** — `jsonlite` is not guaranteed present in a user's environment, so the probe must not depend on it.

A new `SciencePackage { name, version }` list lands on `ScienceInterpreterIdentity` as `packages`, alongside `packagesSha256` (a stable digest over the sorted inventory) and `packagesTruncated`. Because identity facts are `Partial` on a non-`available` binding, a failed observation carries no inventory without a sentinel — the existing honest-capability record already has the right shape.

The inventory is bounded at the point where the complete retained value is known: a validated Runtime `Config` field caps the entry count, and a second caps total bytes; exceeding either sets `packagesTruncated` and keeps the digest over the complete pre-truncation inventory. The cap is deployment-varying (a genomics environment is not a teaching environment), so it is a `Config` field changeable from cordis.yml, not a `DEFAULT_*` constant.

`bindingFingerprint` keeps its current inputs. Folding the package digest into it would silently redefine what counts as the same binding and re-key existing drift behavior; `packagesSha256` is recorded separately so a future drift rule can consume it as an explicit decision.

The client projection passes `packages`, `packagesTruncated`, and a `packagesSha256` preview through unchanged — package names and versions carry no Host path, so `clientInterpreter` needs no new redaction.

**Open the two client seams.** `packages/client/ui-conversation`:

- Declare `conversation.details.header.actions`, a keyed list slot rendered by `DetailsPanel` between the title and its own close button, keyed by details-entry id so only the active entry's controls render. The panel keeps owning the close control; entries contribute their own buttons.
- Add `openDetailsView` to `ToolCallOwnerProps` — `ui-tool`'s `tool.call.toolview` owner share, not a `ui-conversation` type — so a transcript row can select a Details entry and open the column. The capability, the owner, and the store write are the ones `ConversationHeaderActionOwnerProps` already uses; they reach `ToolCallOwnerProps` by riding the existing render path, `ChatNodeOwnerProps` (`ui-conversation`) → `ChatView`/`ChatNodeSeat` → `ToolCallTree`'s per-call dispatch, the same route `openFile` and the trajectory `inspect` callback already take to reach a target neither `ui-tool` nor `ToolCallOwnerProps` owns. This is one more seat on an existing contract and route, not a new one — a `ui-conversation` client-service method was considered and rejected (below) because the per-session Details selection is slot-declared store state the render tree resolves per session; nothing outside that render path can reach the same live instance.

### The artifact panel — Details column

`ScienceDetailsView` becomes the artifact panel. It stays a pure reader of the `science` projection and keeps its own stateless attachment loader.

- **Environment strip** — profile, revision, status, and per language capability, version, fingerprint preview, and package count.
- **Artifact gallery** — one entry per `chartId`: the latest version's thumbnail, `logicalName`, title, and a `v{n}` badge.
- **Artifact detail** — selecting an entry shows the version large, with title, caption, source run, and dimensions, plus a **version rail** listing `v1…vN`. Selecting a version switches the displayed image. This is the surface the whole proposal exists for: the versions are already durable and contiguous, and nothing today lets a person walk them.
- **Header actions** — the entry contributes two buttons through the new slot: **provenance** (opens the view tab below for the selected version) and **expand** (opens the shared `MessageImage` lightbox). The panel's existing close button stays where it is.

Selection is Science viewing state, so **ui-science owns it**: a package-local per-session store holding `{ chartId, version } | null`. It does not go in `ChatStoreState`, which ui-conversation owns and which no other plugin would read.

### The provenance view — conversation view tab

ui-science registers a `conversation.view` entry, id `science.provenance`, labelled from the `science` namespace, gated on the `science` preset by the same check `ScienceHeaderAction` already applies. It renders the four provenance parts for the selected artifact version:

1. **Code** — the run's `code` argument, read from the conversation snapshot by `toolCallId`, with the durable `codeSha256` shown as the anchor.
2. **Execution log** — stdout, stderr, and exit code from the same call's result, with the projection's durable `stdoutBytes`/`stderrBytes` and truncation flags shown alongside as the authoritative measure.
3. **Conversation** — the turn that issued the call, with a jump-to-transcript action. The existing one-shot `ChatStoreState.inspect` handoff already switches the view and reveals a call; this reuses it rather than adding a second channel.
4. **Environment** — the environment revision as a JSON block: profile, revision, status, timestamps, and per language capability, version, fingerprint preview, and the package inventory.

With no artifact selected, and for each individually unavailable part, the view renders a distinct documented state. A run outside the client's loaded conversation window renders code and log as unavailable-pending-history rather than as absent — the durable digest and byte counts still render, so the record never reads as empty when it is merely unloaded.

### The transcript row

`ScienceChartRow` stops being a full card and becomes navigation: a compact row with a small thumbnail, `logicalName`, `v{n}`, and title. Activating it selects that artifact version in the ui-science store and calls `openDetailsView('science')`. A hover-revealed control on the thumbnail opens the lightbox directly, so full-screen viewing stays one action. The running, failed, interrupted, and unparseable fallbacks keep their current text behavior.

### Files this touches

- `packages/science/science-session/src/` — `types.ts` (client chart/run linkage fields, `SciencePackage`, inventory fields), `projection-value.ts` (`clientChart`, `clientRun`, `clientInterpreter`), `projection-schema.ts`, `fold.ts` decoders, `domain.ts` event payload.
- `packages/science/science-runtime/src/` — `environment.ts` (the `packages` probe and its bounds), `config.ts` (the two cap fields).
- `packages/client/ui-conversation/src/client/` — `contract/slots.ts` (new `conversation.details.header.actions` keyed slot, `ChatNodeOwnerProps`/`ChatViewInjected.openDetailsView`), `skeleton/DetailsPanel.tsx`, `skeleton/DetailsPanel.module.css`, `apply.ts`, `chat/ChatView.tsx`, `chat/ChatNodeSeat.tsx`.
- `packages/client/ui-tool/src/client/` — `contract/slots.ts` (`ToolCallOwnerProps.openDetailsView`), `tool/ToolCallTree.tsx`.
- `packages/client/ui-science/src/client/` — `ScienceDetailsView.tsx` (artifact panel), `ScienceChartRow.tsx` (compact row), new `ScienceProvenanceView.tsx`, new selection store, `index.ts` registrations, `locales.ts`.
- READMEs for every package above, in the same change.

## Alternatives considered

**Introduce a `science/artifact-*` event family.** Rejected: `ScienceChartVersion` already is the artifact version — immutable, contiguously versioned, and attachment-bearing. A parallel family would duplicate identity, split replay, and force a rule about which record wins.

**Capture the package inventory per run rather than per environment binding.** Rejected: the inventory is a property of the binding, runs are frequent and short, and per-run capture would multiply durable bytes and probe latency for identical data. The cost is that a mid-session install is invisible until the next binding; `condaHistorySha256` already catches conda-level mutation at that point.

**Use `conda list --json` to get build strings.** Rejected: it requires locating a conda executable outside the configured prefix, which adds an external dependency and a new sandbox surface to a probe path that is currently self-contained. `pip list` and `installed.packages()` report what the interpreter itself sees. The cost is that inventories carry name and version but no build string.

**Use `jsonlite` in the R probe.** Rejected: it is an ordinary CRAN package that a user's environment may not have, and a provenance probe that fails on a valid environment is worse than a TSV parse.

**Fold `packagesSha256` into `bindingFingerprint`.** Rejected for now: it would silently change what "the same binding" means and re-key drift detection as a side effect of adding a capture. Recording the digest separately keeps that a future explicit decision.

**Put artifact selection in `ChatStoreState`.** Rejected: it is Science domain viewing state that only ui-science reads, and ui-conversation owns that store for state its own skeleton dispatches.

**Expose details-opening on `ui-conversation`'s client service (`ctx.conversation`) instead of `ToolCallOwnerProps`.** Rejected: the active Details entry is per-session state in the slot-declared `chatStore`, and the slots engine resolves one live instance per (store handle, session) pair inside its own registry, handed to a component only through the `store`/`actions` share a slot registration receives at render time. `ConversationController` is a root-scoped singleton outside that render path; reaching the same live instance from it would mean adding a second, service-side store-resolution path that duplicates what the registry already owns, to open one seat only `ui-tool`'s render path needs. `openFile` and the trajectory `inspect` callback already ride the `ChatNodeOwnerProps` → `ToolCallOwnerProps` route for the same reason: their target (workspace open, trajectory view) is owned elsewhere, and the owner-props chain is the sanctioned way to reach it without a cross-package value import.

**Render provenance in the Details column instead of a view tab.** Rejected: code, execution logs, and an environment JSON block are wide, and the Details column is clamped to 520px (`DETAILS_MAX`) and auto-closes under concession. The center column is the only surface with room.

**Keep the transcript row as a full chart card.** Rejected: once the panel renders the artifact with its versions, the card is a duplicate that pushes the conversation apart. The row's remaining job is navigation.

**Make the new inventory fields optional so existing logs replay.** Rejected under the pre-release stance: an optional durable field would carry a compatibility promise this repository explicitly does not make, and a required field fails loud at decode instead of silently producing an environment record that cannot state its packages.

## Acceptance criteria

- A chart's client projection carries `toolCallId` and `requestHeaderSeq`, and the browser resolves that chart's `run_code` call from the conversation snapshot with no additional Host route.
- Binding an environment records a package inventory per available interpreter, with name and version per entry, a digest over the complete sorted inventory, and a truncation flag; an unavailable interpreter records none.
- Both inventory caps are validated `Config` fields settable from cordis.yml; an inventory exceeding either cap is truncated, flagged, and still digested over the complete pre-truncation value.
- `bindingFingerprint` is byte-identical to what the same environment produced before this change.
- The Details column shows every logical chart, and selecting one exposes a version rail that switches the rendered version among all durable versions of that chart.
- The Details entry contributes two header controls through the new keyed slot; the panel's own close control is unchanged, and a different Details entry contributes none.
- Activating a transcript chart row opens the Details column on the Science entry with that exact version selected; the thumbnail's hover control opens the lightbox without opening the column.
- The provenance view renders code, execution log, conversation turn, and environment JSON for the selected version, and renders a distinct documented state for each part that is individually unavailable, for a run outside the loaded conversation window, and for no selection at all.
- The provenance tab is absent from a Standard or custom non-Science session.
- Disposing the ui-science and ui-conversation fibers removes every new registration.

## Risks

- **Existing Science session logs stop replaying.** A required inventory field means a `science/environment-bound` payload written before this change fails its decoder. The pre-release stance sanctions this (backends reject old on-disk formats) and no migration is written, but any retained fixture or recorded snapshot containing that event must be re-recorded in the same change.
- **Probe cost lands on environment binding.** `installed.packages()` over a large R library is not instant, and binding is on the path to a session's first run. The probe runs under the existing confinement and timeout, so the failure mode is a bounded delay or an unavailable binding, not a hang.
- **A truncated inventory is a weaker provenance record.** The digest still covers the complete inventory, so truncation is detectable, but a capped list cannot be replayed into an environment.
- **Code and execution log depend on loaded conversation history.** They come from the transcript, which the client loads as a window (`loadOlder`). An artifact whose run predates the loaded window renders unavailable until more history loads; the durable digest and byte counts remain visible so the state is legible rather than empty.
- **`SessionEventMap` payload change reaches both SDKs.** The TypeScript and Python SDK expected outputs and the keyless snapshots (`apps/web/tests/snapshots/science-preset`, `examples/headless-agent/tests/snapshots/science-tools`) must be updated in the same PR; `pnpm run test` covers none of them.
</content>
</invoke>
