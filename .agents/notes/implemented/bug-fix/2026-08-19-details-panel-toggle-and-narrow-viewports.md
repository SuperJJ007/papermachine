# Agent Note: The Details column opens, closes, and fits a narrow viewport

Status: implemented

English | [中文](2026-08-19-details-panel-toggle-and-narrow-viewports.zh.md)

## Problem

Three defects in the same surface, all found by using the shipped Web app rather than by a test.

**The header control opened but never closed.** `ConversationHeaderActionOwnerProps.openDetailsView` selected an entry and called `layout.openDetails()`, whose store action is a no-op when the panel is already open. A session-header button is a persistent affordance a reader presses to look at something and presses again to put it away; ours could only ever open, so the artifact panel had to be dismissed through the panel's own close control.

**The panel could not be opened at all on a narrow viewport, silently.** `computeColumns` runs a concession chain in which the sidebar never concedes: with `CENTER_MIN` at 640, an expanded 280px sidebar plus `DETAILS_MIN` needed 1220px before the panel could render any width. Between the sidebar auto-collapse breakpoint (1024) and 1220 the solver derived a zero details track on every frame, so the header control wrote the open preference, nothing appeared, and no diagnostic explained why. A portrait monitor sits squarely in that band. The existing test suite pinned the behavior rather than catching it ("step 3: details auto-closes … sidebar holds its preference").

**The panel was too narrow for what it now holds.** `DETAILS_MAX` of 520 was chosen when the column showed tool input/output. Artifact content — charts, tables, notebook text — reads at widths a transcript side panel never needed.

## Decision

**Toggle.** The header owner prop is `toggleDetailsView(id)`, and the two directions are decided where both facts are already available. `ConversationSessionHeader` holds `store: chatStore`, so it reads `detailsView` itself: a click naming the entry the store already shows calls the new `ctx.layout.toggleDetails()`, and any other click routes through the existing `openDetailsView(id)` and opens. The layout store's `toggleDetails` action flips `details` between 0 and `DETAILS_DEFAULT` against its own draft, which is the authoritative open/closed fact — no component mirrors panel state, and `LayoutController` stays a pure forwarder over bound actions.

The chat-node path keeps open-only `openDetailsView`: clicking a transcript row means "inspect this", and must never close the panel the reader is inspecting with.

**Geometry.** `CENTER_MIN` drops from 640 to 440, chosen so the two mechanisms line up rather than leaving a gap between them: `SIDEBAR_DEFAULT + DETAILS_MIN + CENTER_MIN` = 1020 ≤ `SIDEBAR_AUTO_COLLAPSE` (1024). Every viewport at or above the breakpoint can therefore seat the panel with the sidebar expanded, and below the breakpoint the sidebar is already the 56px rail, which lowers the admitting width to 796. The dead band is closed by construction, not by widening a constant until the reported case happened to work.

`DETAILS_MAX` rises to 960 and `DETAILS_DEFAULT` to 420. The concession chain still caps what any given viewport grants, so a generous drag ceiling costs nothing on a small screen.

## Alternatives considered

**Make the details panel an overlay drawer below a breakpoint.** The conventional narrow-screen answer, and the first design drafted. Rejected for this pass because it adds a second presentation mode — absolute positioning, its own drag-handle math, a scrim, and a dismissal rule — to fix a band that a constant already closes. It remains the right answer for genuinely small windows: below 796px the panel still cannot open, and an overlay is what would serve that case.

**Reorder the concession chain so the sidebar concedes before the details panel.** Directly expresses "the reader asked for the artifact panel, so the navigation list yields first", and would also close the dead band. Rejected because the sidebar auto-collapse breakpoint already rails the sidebar across almost the whole affected range, leaving the reorder to matter only in a 36px sliver — while introducing a derived-collapse state that `toggleSidebar` does not know about, so the sidebar toggle would appear dead whenever the solver had collapsed the sidebar on its own.

**Let the header action read the panel's open state through a new `ILayout` reader.** Rejected because `LayoutController` holds bound actions, not the store instance, so the reader would have to mirror open/closed inside the controller — a second copy of a fact the store owns, and one that `AppFrame`'s own session-switch `closeDetails()` call would silently desynchronize.

**Keep `openDetailsView` as the header prop name and give it toggle behavior.** Rejected: the name would lie about half of what the callback does, and the chat-node path genuinely keeps open-only semantics, so one name for two behaviors would be actively misleading.

## Consequences

One header control now owns both directions of the panel it opens, and the panel is reachable on every viewport at or above the sidebar breakpoint, including a portrait display. The drag range runs from 300 to 960.

`CENTER_MIN` is now load-bearing in a way it was not: it is pinned to `SIDEBAR_AUTO_COLLAPSE` by an inequality, and raising it without re-checking that relation reopens the dead band. The constant's own doc comment and a dedicated test both state the relation so a future change has to confront it.

What this gives up: below 796px the details panel still auto-closes with no explanation to the reader, unchanged from before. That is the overlay-drawer case named above, and it is deliberately deferred rather than solved.

## Testing

`packages/client/ui-layout/tests/columns.client.spec.ts` pins the breakpoint relation as an assertion over the constants themselves, so the dead band cannot return through a constant edit, and covers the widened drag ceiling. `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` drives the header owner prop through all three cases — first open, repeat click closing, and a different entry routing without closing. `packages/client/ui-science/tests/ScienceHeaderAction.client.spec.tsx` proves the action forwards every click identically and holds no panel state of its own. The `ui-layout` app-frame tests carry the new geometry through the rendered grid tracks and the drag base.
