# Agent Note: Science trajectory and transcript information architecture

Status: implemented

English | [中文](2026-08-25-science-trajectory-and-transcript-ia.zh.md)

## Problem

Science exposed its semantic trace as a conversation-level peer of the engineering Trajectory ledger, repeated Assistant prose inside the trace, rendered execution output openly in Chat, and placed artifact cards beside individual Tool calls. The same Turn could therefore repeat its answer, process output, and files across several surfaces. A separate Outcome Details destination also treated a published conclusion as a persistent object even though its durable context already lived in the transcript.

## Decision

Trajectory owns a session-scoped `trajectory.view` extension slot and a `TrajectorySubviewRegistry`. The built-in `detailed` entry contains the native timeline and ledger. Science contributes `swimlane` with a lower order and a reactive visibility source, so it is the default inside Trajectory for Science Sessions while non-Science Sessions retain Detailed as their only entry. Selection is per Session, and visited entries remain mounted while hidden so switching views does not discard local inspection state. Slot, visibility, locale, unload, and hot-reload changes invalidate the outer shell through stable external-store snapshots.

The Swimlane is a visual index over authoritative conversation and Science projection facts. Each generated Turn has one card with exactly three presentation rows: a one-line user request, a one-line language-count and failure summary, and a non-wrapping row of exact artifact-version chips. Long or unbroken text is clamped within the card. Assistant prose and agent conclusions do not enter this projection. The structured run summary opens the corresponding call in Detailed, and artifact chips open the selected version in Science Details.

Chat keeps Assistant prose unchanged and folds process detail. `run_python`, `run_r`, `annotate_artifact`, and `publish_outcome` use one-line cells whose code, output, or evidence mounts only after expansion. Cell expansion is component-local state and does not enter the Session log or a model request.

Science registers a Turn-scoped conversation Definition that accumulates valid `science/artifact` Tool-result presentation values. It retains one entry per logical artifact and replaces it only with an equal or higher version. A Turn-tail contribution renders that final set after the Assistant reply, so artifact cards occur once per Turn rather than beside each producing or curating call. Opening a card writes the exact artifact id and version to the existing shared selection store.

The sidebar and Details column expose Files only. Published Outcomes remain available through their collapsed transcript cells; there is no Outcome-only Details destination or Outcome section in the artifact landing view.

## Alternatives considered

**Keep Swimlane as a peer conversation tab.** Rejected because semantic and engineering trajectories are two representations of the same causal record. A nested extension point gives them one stable destination and lets the generic Trajectory package remain independent of Science.

**Unmount inactive Trajectory subviews.** Rejected because returning from Detailed would discard local folding, timeline focus, and inspection state. The shell mounts a subview after its first visit and then changes only its visibility.

**Render artifact cards at each Tool call.** Rejected because one logical artifact can be captured and curated more than once in one Turn. Turn-scoped accumulation gives the transcript one final, version-aware file group.

**Derive Turn-end artifacts from the current Science projection.** Rejected because the projection is Session-wide and can advance independently of a loaded Turn. The append-surface Tool result already carries the presentation value associated with that Turn.

**Persist cell expansion.** Rejected because expansion is presentation preference, not a durable conversation fact or model input.

## Consequences

Plugins that need another Trajectory representation register `trajectory.view` and may register a matching visibility source without changing `ui-trajectory`. Science Sessions present Swimlane before Detailed, while all outer conversation navigation continues to address one `trajectory` view.

The transcript remains the only full prose account. Swimlane cards are bounded factual summaries, execution detail is opt-in, and each Turn has at most one final artifact group. A Tool result without valid tagged artifact presentation metadata contributes no Turn-end card even if the Session projection later contains a related artifact.

This decision narrows the Trace and Outcome placement described in [Science workbench UI convergence](2026-08-23-science-workbench-ui-convergence.md). That note remains active for the Files stage, composer selections, settings, kernel status, light-palette composition, and desktop toggle placement.
