# Agent Note: Persist the Details panel across reloads; localize workspace-file open errors

Status: proposed

English | [中文](2026-09-01-details-panel-persistence-and-workspace-error-i18n.zh.md)

## Problem

Two independent product gaps surfaced from real-machine acceptance of Science:

1. `packages/client/ui-layout/src/client/stores.ts`'s layout store (sidebar width, Details width/open-closed, and the narrow-viewport breakpoint pair) declared no `persist`. Every field reset on reload, so a user who opened the Details column to read an artifact tab or a project file lost it on the next reload and had to reopen it — the panel that holds a user's open work state behaved as if it held none.
2. `packages/host/apiproxy/src/api-proxy.ts`'s `workspaceFile` RPC throws a closed-enum `WorkspaceReadError` (`NO_WORKSPACE` | `PATH_OUTSIDE_WORKSPACE` | `FILE_TOO_LARGE`) carried to the client as `science-artifact-error`'s `details.reason`, but `packages/client/ui-science/src/client/ScienceDetailsView.tsx`'s `WorkspaceFilePreview` rendered the host's raw English `error.message` (e.g. "Workspace file exceeds the 2 MiB preview limit.") directly onto a Chinese-locale screen.

## Proposal

**Details-only persistence.** Give `createLayoutStore()` a versioned `persist` key (`dsh.layout.panels.v1`) so its state round-trips through `localStorage` via the existing `client/runtime` snapshot-store engine (`attachPersistence`, top-level merge over `init()`). Declare `sidebar`, `narrow`, and `narrowExpanded` as `transient` so only `details` (the width/open-closed preference) is written to and read back from storage — the persistence is intentionally asymmetric between the two panel-width fields, against this repo's usual preference for symmetric parallel values:

- **Details persists** because it is the workspace surface for documents the user opened on purpose — artifact tabs, project files — and the user asked for that state to survive a reload.
- **Sidebar stays transient** because it is navigation chrome, not saved work state, and `apps/web/tests/smoke-real.e2e.ts` ("sidebar drag widens the column and resets across reload") already pins its reload-reset as intended product behavior; persisting it would contradict that coverage.
- **`narrow`/`narrowExpanded` stay transient** because they are live derivations of the current viewport's breakpoint (`AppFrame`'s `setNarrow`), never a saved preference — persisting them would let a state captured at a narrow viewport leak into the next load at a wide one.

The asymmetry is recorded in `stores.ts`'s JSDoc on `createLayoutStore()`, not only here.

Investigated but not reproduced: a real-machine acceptance note reported the Details column first rendering at a visibly wrong width (roughly 120–200px, below the panel's own 300px `DETAILS_MIN` floor) on its first open after a reload, self-correcting only after a manual drag. Tracing every path that sets `details` (`openDetails`, `setDetails`, and `computeColumns`'s three-step concession chain in `columns.ts`) shows every one clamps to `[DETAILS_MIN, DETAILS_MAX]` or to `0` — no code path produces a sub-`DETAILS_MIN` open width. The one mechanism found that can *visually* show an intermediate value in that range is `AppFrame.module.css`'s `transition: grid-template-columns 0.3s ease-in-out`: opening Details animates the grid track from `0` to its resolved width, so a screenshot or observation taken mid-transition passes through every value in between, including 120–200px, and settles at the correct width on its own — no interaction required. This is consistent with the original report being irreproducible on demand. No defensive code was added against this: the brief for this change explicitly asked not to add insurance code without a found mechanism, and none was found in the data or clamp logic — only a benign, self-resolving rendering explanation.

**Reason-mapped workspace-file errors.** `ScienceDetailsView.tsx` gains `workspaceFileErrorText(error, t)`, which reads `error.details.reason` when `error.code === 'science-artifact-error'` and switches on the three known `WorkspaceReadError` reasons, falling back to a generic localized notice for a missing or unrecognized reason (a future host reason this build predates, or any other error code). `WorkspaceFilePreview`'s single `setError(result.error.message)` call site becomes `setError(workspaceFileErrorText(result.error, t))`. Four new `science` namespace keys (`library.fileNoWorkspace`, `library.filePathOutside`, `library.fileTooLarge`, `library.fileOpenFailed`) are added in both `zh` and `en` (`locales.ts`), phrased to match the existing `library.unsupported` tone (short, plain, no stack-trace vocabulary) and using "文件" (file) rather than "成果" (artifact) since this is the project-file preview, not the artifact viewer. The host's `WorkspaceReadError` text is unchanged — it remains the log-facing and non-localized-caller-facing string; only the client's rendering of it changes.

Six other `setError(result.error.message)` call sites in the same file were investigated but deliberately left unchanged this round (see the table in the accompanying commit's report); two of them (`loadLibrary`, `loadWorkspaceFiles`) already carry a `details.reason` string today and could be mapped the same way, while four (`addArtifactNote`, `removeArtifactNote`, `applyChartOps`, `previewChartOps`) only expose `{ message: string }` on the `ScienceDetailsInjected` interface even though the underlying Typert `RemoteFailure` actually carries a `code`/`details` pair (`ScienceEditErrorCode`) — mapping those requires widening that interface first.

## Alternatives considered

- **Persist the whole layout store (including sidebar).** Rejected: contradicts the existing, deliberately-kept `apps/web/tests/smoke-real.e2e.ts` sidebar-reset assertion and the sidebar's role as navigation chrome rather than saved work state.
- **A single unversioned persist key.** Rejected in favor of the repo's established versioned-suffix convention (`dsh.science.selection.v1`, `dsh.workspace.view.v5`) so a future structural change to `LayoutState` can bump the suffix instead of reconciling an old shape in place.
- **Map the workspace-file error text via a lookup object instead of a `switch`.** Rejected: the repo convention for a closed set of discriminants is a `switch`, and the `default` branch here documents exactly what it covers (missing/unrecognized reason and non-`science-artifact-error` failures) per that convention.
- **Widen `ScienceDetailsInjected` to expose `code`/`details` for all seven `setError` call sites in one change.** Rejected as out of scope for this task: the brief scoped the fix to the one already-reachable, already-reported English-leak (`WorkspaceFilePreview`), and asked the other six to be investigated, not changed, this round.
- **Add a defensive floor/clamp for the reported bad-width-on-first-open symptom.** Rejected: no reproducing mechanism was found in the width-computation or clamp code, and the repo's brief for this change explicitly rejected adding insurance code without one.

## Acceptance criteria

- The Details column's open/closed state and dragged width survive a reload; the sidebar's width and the narrow-viewport fields do not.
- A stored payload missing fields this build now declares (a legacy or partial payload) rehydrates without throwing, keeping `init()`'s value for the missing fields.
- A stored payload carrying `narrow`/`narrowExpanded` values is never read back into the live store on rehydration, and neither field is ever written to storage.
- Each of the three `WorkspaceReadError` reasons, and an absent/unrecognized reason, renders its own distinct localized notice in both `zh` and `en`; the host's raw English `error.message` never appears on screen for this call site.
- `pnpm run typecheck` and the affected packages' unit tests (`ui-layout`, `ui-science`) pass.

## Risks

- Enabling persistence on a previously-transient store changes test isolation assumptions for any test file that mounts `createLayoutStore()` (or `AppFrame`, which seats it) more than once per process without clearing `localStorage` between mounts; `packages/client/ui-layout/tests/app-frame.client.spec.tsx` needed a `localStorage.clear()` added to its `beforeEach` for this reason, and any future test file doing the same must do likewise.
- The workspace-file error mapping's `default` fallback intentionally discards a host reason this build does not recognize (including a future reason value) in favor of a generic notice; a maintainer adding a new `WorkspaceReadError` reason on the host must add a matching client case (or accept the generic fallback) rather than assuming the mapping is exhaustive by construction.
