# Agent Note: Artifact object state and turn-local causality

Status: implemented

English | [中文](2026-08-25-artifact-object-state-and-turn-local-causality.zh.md)

## Problem

The Science artifact stage had accumulated causal information beside object state: Diff and Provenance modes, nested Code/Log/Messages/Review/Environment tabs, and links to session-wide Trace and Trajectory views. The same generated answer appeared in chat, a semantic group, and an agent-conclusion card. This made the artifact panel answer both “what is this object now?” and “how did this turn produce it?”, while user annotations had no durable, private home.

## Decision

Conversation owns time and causality. Every assistant turn that produces artifacts receives a compact turn-tail entry and an inline three-row trace: one truncated user-request row, one structured fact row, and one run/artifact action row. Run actions may expand code, execution output, and environment facts; artifact actions open exact versions. The trace never copies assistant prose. Facts without an authoritative durable source, including package installation and manual-operation categories, stay absent rather than being inferred from code or output text.

The artifact stage owns object state. It retains preview, exact-version navigation, user-only notes, and a jump to the assistant message that produced the selected version. Diff and the top-level Provenance mode are absent. Code, log, and environment renderers survive only as message-side run details. Review, agent-conclusion, and persistent Trace/semantic-lane controls are deleted.

Artifact notes are durable but not model-visible. `science/artifact-note-added` and `science/artifact-note-removed` are merge-extensible Session events declared safe to skip and appended with `ignorable: true`; `SESSION_FORMAT_VERSION` remains `0`. A separate `scienceArtifactNotes` projection folds active notes by logical artifact. Host Remotes validate exact artifact versions and active note sequences before appending. Notes never enter `ScienceClientProjection`, prompt assembly, or `Agent.followup()`.

`Session.append()` accepts the ignorable marker only for event types merged into `IgnorableSessionEventMap`, and requires the literal marker for those types. This prevents a caller from accidentally marking required runtime facts as optional to older readers.

This decision supersedes only the artifact-view modes and session-wide Trace placement in [Science workbench UI convergence](2026-08-23-science-workbench-ui-convergence.md). Its shell, navigation, composer, and direct-edit decisions remain current.

## Alternatives considered

**Keep Provenance in the artifact stage and add a turn-local shortcut.** Rejected because two causal homes drift and make the object panel's permanent navigation depend on how the object was produced.

**Keep the agent-conclusion card but truncate it.** Rejected because the adjacent assistant message is already the complete source and truncation still creates a second, potentially misleading copy.

**Store notes in browser state.** Rejected because notes would disappear across reloads and devices and could not participate in session export or restore.

**Add notes to the main Science projection.** Rejected because runtime and model-facing consumers read that projection; a separate projection makes the user-only guarantee explicit and reviewable.

**Mark every non-surface event ignorable through a generic append option.** Rejected because required lifecycle and runtime facts could then be mislabeled. The merge-extensible allowlist makes skip safety an owned declaration.

## Consequences

The viewer has one content mode and a smaller selection store. Turn traces stay attached to their producing chat context and enforce the three-row budget through component structure, CSS truncation, and narrow-width tests. Run details can extend below the compact card without changing that budget.

Notes work for every accepted artifact media type, persist in the session log, and remain absent from model requests. Older builds skip the two note event types instead of rejecting the log, while all existing Science domain events remain required on read. Focused projection, Remote, viewer, turn-tail, assembled-client, and keyless snapshot coverage pin these properties.
