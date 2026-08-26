# Agent Note: Science artifact provenance and private review

Status: implemented

English | [中文](2026-08-26-science-artifact-provenance-review.zh.md)

## Problem

Artifact provenance repeated the same generating-turn summary above every subview and left the Messages subview with only technical request facts. Its two summary actions both led to trajectory surfaces, so the viewer had no route back to the original conversational context. Artifact review notes had also been removed before the project artifact store introduced store-owned artifact identities.

## Decision

The provenance breadcrumb and Code, Execution log, Messages, and Environment subviews remain. The shared summary card is removed. Messages alone shows the nearest preceding user text as the question and the turn's final assistant text as the result; CSS clamps each summary to three lines while the conversation remains the only complete source. “Back to original conversation” switches to Chat and centers the generating assistant-step semantic anchor. “View trajectory” selects detailed Trajectory and inspects the source run call.

Every artifact version now projects its producer Session id from the project artifact store. When that id differs from the current Session, Messages renders the source Session title as inert text and exposes neither navigation action. Cross-Session navigation remains deferred until the project file library owns that workflow.

The viewer content page restores private review notes keyed by the store `ScienceArtifactId`. Dedicated add/remove Remotes append ignorable Session events folded by the independent `scienceArtifactNotes` projection. The add Remote validates the exact visible version and enforces 8,192 characters; remove validates the active add-event sequence and artifact. These events are not surface events, queue no follow-up, and never enter model requests. Review notes stay beside the artifact preview and do not appear in provenance.

## Alternatives considered

**Replay the complete generating dialogue in provenance** — rejected because Chat is the authoritative context and duplicated dialogue would drift from its loaded-history and rendering semantics. The bounded question/result summary provides orientation; explicit actions reach the authoritative Chat or Trajectory surface.

**Store review notes in the project artifact store immediately** — deferred because the current viewer is Session-projected while the project-level file library and its browser read path remain a separate change. Session-local ignorable events preserve private notes without defining premature cross-Session ownership.

## Consequences

Chat owns semantic-anchor scrolling and saved reader position, while the conversation service owns the one-shot handoff across view mounting. Provenance contains a bounded causal summary with navigation, not copied dialogue. Notes persist within one Session only; project-wide note visibility is deferred with the store-backed file library. Artifact events and their client projection retain `producerSessionId`, so a browser can distinguish local and foreign provenance without inferring from run ids.
