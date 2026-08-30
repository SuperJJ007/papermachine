# Agent Note: The Details column defaults to the registered primary view

Status: proposed

English | [中文](2026-08-30-science-details-default-view.zh.md)

## Problem

A session's Details column reached "not the artifact library" through three independent surfaces, each fixed by a distinct gate: a blank session (`AppFrame.tsx` rendered the root-scoped `details.files` slot instead of the session-scoped `details` slot whenever `detailsSession` — not `current` — was undefined, conflating the blank-session detour with the true no-session welcome page); a session whose Science mode had not bound yet (`science === null`, `ScienceDetailsView.tsx` rendered an "unbound" notice instead of the artifact viewer); and a session that had never explicitly opened any Details view (`DetailsPanel.tsx resolveActiveDetailsView` fell straight to the built-in `tool` entry with no way for a domain package to claim the default). A user opening a brand-new conversation saw a "文件"/"选择一个会话" empty state, then — after sending one message — "此会话尚无 Science 活动", then — before ever clicking a message-stream tool row — "点击消息流中的工具行查看详情". None of the three states showed the artifact library the product treats as the one unified Artifact surface.

## Proposal

Unify the three gates:

1. **`AppFrame.tsx`** renders the session-scoped `details` slot for any current Session (blank included) and falls back to the root-scoped `details.files` slot only when no Session is current at all — the branch condition moves from `detailsSession === undefined` to `current === undefined`. The existing auto-close effect, keyed on non-blank `detailsSession`, is untouched: a blank-session detour still does not close an already-open panel.
2. **ui-slots' generic `register()`** gains a `primary?: true` option on `list`-kind entries (`packages/client/ui-slots/src/index.ts`): a list entry may declare itself the slot's default when the consumer has not explicitly selected one. At most one entry per slot may carry it; a second `primary: true` registration throws at load time naming the existing one, the same fail-loud posture every other kind constraint in `register()` already has. `ui-conversation`'s `DetailsPanel.tsx resolveActiveDetailsView` resolves an explicit `selectedId` hit first, then the registered `primary` entry, then the built-in `tool` entry.
3. **`ui-science`'s `conversation.details.view` registration** for `id: 'science'` adds `primary: true`, making the artifact library the Details column's default entry.
4. **`ScienceDetailsView.tsx`** replaces its `science === null` branch (the "unbound" notice) with a client-side placeholder projection (`EMPTY_SCIENCE_PROJECTION`: empty `artifacts`/`runs`/`kernels`, `null` `environment`/`outcome`) fed into the same `ArtifactViewer` a bound session uses. The artifact library itself loads through the `loadLibrary` RPC (`sessions.scienceLibrary`, project-wide, grouped by producing conversation) independent of this session's own `science` projection, so an unbound session shows the exact same library a bound session with zero artifacts would — no second notice. The `science === undefined` branch (the deployment does not compose a Science Session projection at all) is unrelated and unchanged.

With all four surfaces resolved, a fresh conversation's Details column shows the artifact library from first paint through every following state, and the three retired locale keys (`details.unbound`, `details.preset`, and the `ScienceEmptyDetails`/`nav.files` "文件" copy, now "产物"/"Artifacts") no longer describe anything reachable.

Discipline packs (`.agents/tmp/agent-work/2026-08-26-discipline-packs/FEASIBILITY-REVIEW.md`) are a content layer on the `science` preset, not a new preset, so every existing `agentPreset === 'science'` gate this change touches (`ScienceDestinations`, `ScienceHeaderAction`, `ScienceHeroAction`, `AppFrame`'s `data-science-session`, `createTraceVisibilitySource`) already covers them without modification.

## Alternatives considered

**Have `ui-science` call `openDetailsView('science')` on session mount instead of a `primary` registration option.** This would also select the artifact library by default, but `openDetailsView` opens the Details column as a side effect — a session that has never touched Details would pop the column open on its own, contradicting the product's own closed/open panel state. A `primary` entry only changes what renders *if* the column is already open (or opens through `AppFrame`'s existing Part-A branch); it never opens a closed column.

**Treat the lowest `order` value as the implicit default instead of adding a `primary` option.** `order` controls the Details header's page ordering among multiple registered entries (today just `tool` and `science`); overloading it to also mean "shown by default" conflates two independent axes — a future third entry could need a specific display position without wanting to be the default, or vice versa. A dedicated boolean keeps the two questions separate and lets `register()` enforce "at most one" the same way it enforces one occupant per `single` slot and one entry per `list` id.

## Acceptance criteria

`AppFrame` renders `details` (not `details.files`) whenever a current Session exists, blank or not, and `details.files` only with no current Session at all; the existing blank-transition auto-close-skip behavior is unchanged. `ui-slots`' `register()` accepts `primary: true` on a `list`-kind entry and throws, naming the existing primary entry, on a second one for the same slot. `DetailsPanel`'s `resolveActiveDetailsView` returns an explicit selection over `primary` over `tool`, in that order. `ui-science`'s `conversation.details.view` registration carries `primary: true`. `ScienceDetailsView` renders the artifact library (not an "unbound" notice) for `science === null`, with `loadLibrary` invoked and the library grouped exactly as it is for a bound session; `science === undefined` keeps its own distinct notice. A keyless web snapshot (`science-artifact-types.e2e.ts`) replays a brand-new blank session showing the "产物 | 项目文件" header, other sessions' groups in the library, and none of "文件", "选择一个会话", "尚无 Science 活动", or "点击消息流中的工具行" in the DOM.

## Risks

`primary` is a new generic capability on every `list`-kind slot in the framework, not scoped to `conversation.details.view` — any future package composing several list-kind slots inherits the same "at most one primary, enforced at registration" contract, which is the intended generality (the same registration-time uniqueness `register()` already enforces for `single` occupancy and `list`/`keyed` cell identity). A Details entry that declares `primary: true` and is later removed (fiber disposal, HMR) silently drops the Details column back to the built-in `tool` fallback with no primary at all; this matches the existing "stale selection falls to `tool`" posture and requires no additional handling.
