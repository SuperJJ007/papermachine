# Agent Note: Persist the Details panel across reloads; localize workspace-file open errors

Status: implemented

English | [中文](2026-09-01-details-panel-persistence-and-workspace-error-i18n.zh.md)

## Problem

Real-machine acceptance of the Science workbench surfaced two independent gaps.

`createLayoutStore()` (`packages/client/ui-layout/src/client/stores.ts`) declared no `persist`, so every field — sidebar width, Details width and open/closed state, and the narrow-viewport pair — reset on reload. A user who opened the Details column onto an artifact tab or a project file lost that column on the next reload: the panel holding open work state behaved as if it held none.

`WorkspaceFilePreview` (`packages/client/ui-science/src/client/ScienceDetailsView.tsx`) rendered the host's raw English `error.message` onto a Chinese-locale screen — "Workspace file exceeds the 2 MiB preview limit." The host already carries a closed-enum reason for exactly this purpose: `workspaceFile` throws `WorkspaceReadError` (`NO_WORKSPACE` | `PATH_OUTSIDE_WORKSPACE` | `FILE_TOO_LARGE`, `packages/host/apiproxy/src/api-proxy.ts`) and sends it as `science-artifact-error`'s `details.reason`.

## Decision

The layout store persists under the versioned key `dsh.layout.panels.v1` and declares `sidebar`, `narrow`, and `narrowExpanded` as `transient`, so only `details` round-trips through `localStorage`. Persistence is deliberately asymmetric between the two panel-width fields, against this repository's usual preference for symmetric parallel values: Details is the workspace surface for documents a user opened on purpose, and the product owner asked for it to survive a reload; the sidebar is navigation chrome whose reload-reset `apps/web/tests/smoke-real.e2e.ts` pins as intended ("sidebar drag widens the column and resets across reload"); `narrow`/`narrowExpanded` are live derivations of the viewport breakpoint that `AppFrame` feeds through `setNarrow`, so persisting them would leak a narrow-viewport state into the next load at a wide one. `stores.ts`'s JSDoc carries the same reasoning at the declaration.

`workspaceFileErrorText(error, t)` switches on `details.reason` for `science-artifact-error` failures and maps the three reasons to `library.fileNoWorkspace`, `library.filePathOutside`, and `library.fileTooLarge`; a missing or unrecognized reason and every other error code fall back to `library.fileOpenFailed`. All four keys exist in `zh` and `en` (`locales.ts`) and are phrased like the neighbouring `library.unsupported` — short, plain, no stack-trace vocabulary — and say 文件 rather than 成果 because this is the project-file preview, not the artifact viewer. The host's error text is unchanged: it remains the log-facing and non-localized-caller-facing string.

## Alternatives considered

**Persist the whole layout store, sidebar included.** Rejected: it contradicts the sidebar-reset assertion that smoke-real already pins as product behavior, and the sidebar is navigation chrome rather than saved work state.

**Localize by rewriting the host's error text.** Rejected: the host string serves logs and callers that carry no locale. The structured `details.reason` is what a localized surface consumes.

**Widen `ScienceDetailsInjected` and map all seven `setError(result.error.message)` call sites at once.** Rejected as one change: `loadLibrary` and `loadWorkspaceFiles` already carry a reason and could be mapped with the same technique, while `addArtifactNote`, `removeArtifactNote`, `applyChartOps`, and `previewChartOps` expose only `{ message }` on that interface even though the underlying Typert `RemoteFailure` carries `code`/`details`. All six still reach a Chinese screen in English.

**Clamp defensively against the reported bad first-open width.** Rejected: acceptance reported the Details column first rendering near 120–200px, below its own 300px `DETAILS_MIN`, self-correcting after a manual drag. Every path that writes `details` (`openDetails`, `setDetails`, and `columns.ts`'s concession chain) clamps to `[DETAILS_MIN, DETAILS_MAX]` or `0`, so no data path produces that width. `AppFrame.module.css`'s `transition: grid-template-columns 0.3s ease-in-out` animates the track from `0` through every intermediate value on open, which an observation taken mid-transition sees and which settles on its own — consistent with the symptom being irreproducible on demand. Insurance code without a found mechanism buys nothing.

## Consequences

Enabling persistence on a previously transient store changes test isolation: any test file that seats `createLayoutStore()` (or `AppFrame`, which seats it) more than once per process must clear `localStorage` between mounts. `packages/client/ui-layout/tests/app-frame.client.spec.tsx` needed exactly that, and its resize and collapse assertions failed until it got it.

The error mapping's `default` branch discards a host reason this build does not recognize in favour of a generic notice, so a maintainer adding a `WorkspaceReadError` reason on the host adds the matching client case or accepts the generic fallback; the mapping is not exhaustive by construction.

## Testing

`layout-store.client.spec.ts` covers Details surviving a second `create()` while sidebar and the narrow pair reset, the narrow pair never being written, a stored payload carrying them being ignored on read, and a legacy payload missing every declared field rehydrating without throwing. `ScienceDetailsView.client.spec.tsx` covers each of the three reasons, an unrecognized reason, and a missing reason in both locales, and asserts the host's raw text never reaches the screen.
