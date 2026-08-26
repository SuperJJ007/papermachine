# Agent Note: Science transcript process-detail chrome suppression

Status: implemented

English | [中文](2026-08-25-science-transcript-chrome-suppression.zh.md)

## Problem

Screen testing of the Science conversation flow found five kinds of process detail still laid out flat in the chat column: context-injection disclosure rows, full Think blocks, unfolded non-Science Tool call rows, per-turn run-time/TTFT/throughput text, and a branch-availability hint occupying its own line. [Part 3](2026-08-25-science-trajectory-and-transcript-ia.md) had already folded Science's own `run_python`/`run_r`/`annotate_artifact`/`publish_outcome` rows and moved artifact cards to the Turn tail; this note covers the five remaining items named from real screenshots.

Inspecting the current code before changing it found three of the five already satisfied: Think blocks collapse to a one-line summary by default (`ReasoningRow`), every non-Science Tool call already collapses through `ui-tool`'s generic `ToolRow` (the `GenericToolCard` dispatch fallback, and every dedicated toolview built on the same primitive), and the branch-unavailable hint already surfaces only as a Tooltip on the branch button plus a screen-reader-only description, never a flow row. Only context-injection rows and per-turn timing text were genuinely still always-on.

## Decision

Both remaining rows are conversation-flow behavior that only Science should change: `ui-conversation` is a generic package other products load without Science, and every non-Science web e2e golden (turn-tail-actions, message-actions, and 30+ others) legitimately keeps both — Science's own denser presentation (folded Tool cells, Turn-end artifact groups) is what makes them redundant there, not a general product decision.

`ui-conversation`'s 'conversation.chat.node' slot declaration gains one more Hook alongside the existing `turnData` factory: `processDetailVisible`, backed by a new `IConversation.registerTranscriptDetailVisibility(source)` on `ConversationController`, shaped exactly like the existing `registerViewVisibility`/`ViewVisibilitySource` pair (a `visible(sessionId)` predicate plus `subscribe(callback)` invalidation). `ContextMessageNodeView` calls the Hook and returns null when it reports `false` — not a collapsed row, no DOM footprint at all, so `[data-turn-tail]`-style empty flex-gap padding never appears either. `TurnTailNodeView` calls it to decide whether `MessageIconActions` receives `runMs`/`ttftMs`/`tokensPerSecond`; the plain clock always renders, since a bare timestamp is not the timing metadata the brief named. `ui-conversation` renders both unconditionally by default (no registrant) and never imports Science; `ui-science` is the only registrant, supplying `createTranscriptDetailVisibilitySource` — the same reactive "does this Session qualify for the Swimlane" predicate the Trajectory subview already uses, inverted, so a Session that gets the Swimlane also loses this chrome.

This is the established extension-point shape in this package (`registerViewVisibility`, `registerSubmissionHandler`) rather than keyed-slot shadowing: shadowing a `conversation.chat.node` key would need the shadow's own component to either duplicate `ContextMessageNodeView`/`TurnTailNodeView` or import them, and `packages/client/AGENTS.md`'s export discipline forbids importing another plugin's implementation components across a package boundary — only the slot system and ctx services are sanctioned routes, and a Hook threaded through the slot-level `inject` face is the slot system.

## Alternatives considered

**Suppress unconditionally in `ui-conversation`.** Rejected: 32+ existing non-Science web e2e goldens (skill invocation, subagent, workflow, live-interaction scenarios) show both rows and have no reason to lose them; a global removal would also delete debugging visibility the base harness dev experience still needs.

**Shadow the `conversation.chat.node` keys from `ui-science` with cross-package component imports.** Rejected by `packages/client/AGENTS.md`'s export discipline (`ContextMessageNodeView`/`TurnTailNodeView` are internal, and cross-package imports of another plugin's implementation are forbidden in principle); reusing the components through the shared Hook instead needs no import and adds only one optional field to each component's already-open props.

**Read the `science` Session projection directly inside `ui-conversation`'s components.** Rejected: it would require `ui-conversation` to import `dsh-science-session`'s type merge, hardcoding Science awareness into a package every non-Science product also loads.

## Consequences

`ui-conversation` carries one new capability seam (`registerTranscriptDetailVisibility`) with the identical shape and reactivity contract as `registerViewVisibility`, so future domain packages compose the same way without another bespoke registry. The suppressed content stays reconstructable from the durable log: the context row through Trajectory's detailed subview (already independent of the chat-flow builder), the timing figures through the composer dock's whole-session stats strip (an aggregate `sessionStats` projection unaffected by this suppression). A new keyless web e2e scenario (`science-transcript-chrome.e2e.ts`) proves both suppressions end to end against a hand-built, deterministic session fixture — no LLM recording needed — while the pre-existing `turn-tail-actions`/`message-actions` goldens prove non-Science Sessions are untouched.

The conversation flow's final-form definition, for future reference: user messages → Tool groups/execution cards → the final Assistant reply → one Turn-end artifact group. An adjacent run of two or more ordinary Tool calls collects under one generated group title (`ui-conversation`'s `ToolGroup`); a lone call keeps its ordinary single row, and Science's own `run_python`/`run_r` eight-state execution cards ([run-row states and Tool groups note](2026-08-26-science-run-row-states-and-tool-groups.md)) render identically nested inside a group or ungrouped. Items already satisfied before this change (Think collapse, generic Tool folding, the branch hint) needed no code change; they are recorded here only so a future reader does not re-diagnose them as gaps.
