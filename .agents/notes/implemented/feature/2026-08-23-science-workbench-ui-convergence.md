# Agent Note: Science workbench UI convergence

Status: implemented

English | [中文](2026-08-23-science-workbench-ui-convergence.zh.md)

## Problem

Science artifacts were reachable through a session Details action, but the surrounding product still treated conversation as the primary workspace. Project files and Outcomes lacked stable destinations, model-assisted edits used a second instruction composer inside the artifact viewer, and the engineering Trajectory view was the only event-level account available from the conversation view ring. These splits duplicated navigation and made selected chart elements disappear from the user's main request context.

## Decision

The Web shell presents Science Files and Outcomes as distinct destinations above the session browser only while a Science Session is current. Settings remains fixed at the sidebar foot. Files opens the artifact stage; Outcomes opens a separate Outcome-only route. The complete three-column Science workbench uses the light document palette even when the application preference is dark, while non-Science Sessions receive none of the Science destinations, Trace tab, composer accessory, or kernel dock.

The Science Details entry remains the authoritative artifact stage described by [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.md): opened artifacts use tabs, each tab owns version, provenance, download, and media-specific content, and data views are read-only. A Vega-Lite element row separates human style selection from model selection: clicking the name or chart opens the style panel, while the row's `+` control stages the exact path and optional element comment in the main composer. Composer-chip removal immediately restores the row's `+` state. A submission with chips becomes one durable `science-edit` user message with an ordered `targets` array; each target identifies its exact artifact version and may carry its own validated comment. Host admission validates every target against the complete folded session before enqueueing anything and identifies a failed list position. Successful submission clears every chip; ordinary image attachments cannot accompany this structured edit.

Direct Vega-Lite style controls remain in the stage and commit a human-edit version without a model request. The embedded artifact instruction field and send action are absent, so model-assisted artifact changes have one composer and one visible request path.

The Science-only conversation ring includes a user-facing Trace view projected from loaded real Session nodes and the client-safe Science projection. Each turn is one intent group summarizing run attempts, failures, elapsed run time, artifact deltas, delegation, and miscellaneous tools; structured run and artifact fields alone choose the title. User messages, structured selections, and direct human edits occupy the user side of the center timeline, while agent groups and conclusions occupy the opposite side. Artifact provenance begins with the generating turn's compact user request and agent conclusion; explicit `call:` and `turn:` buttons open Trajectory and semantic Trace, while `artifact:` actions open the exact artifact stage. Persistent-kernel language, epoch, and lifecycle state also appear in one fixed readout below the main composer.

The conversation service owns a per-view Session-visibility registry and mounted view opener. Science registers Trace visibility from the selected preset or live projection, so ordinary conversations have no Science tab while provenance can still open Trace at an exact `turn:` anchor. Target chips read from the Science locale rather than embedding English. The export implementation remains outside this decision; the artifact toolbar carries a disabled localized placeholder until C4 supplies the operation.

## Alternatives considered

**Keep a second composer in the artifact stage.** Rejected because two send paths divide one request between artifact-local state and conversation history, and they cannot express one instruction over targets from several artifacts.

**Send one message per selected target.** Rejected because the user's instruction applies to the selection as a set; independent admissions permit partial acceptance and remove the requirement that the model coordinate the edits.

**Expose the engineering Trajectory ledger as the only trace.** Rejected because its raw event inspection and timing controls serve debugging. A compact semantic projection supports the user's causal reading while retaining a direct path to the ledger.

**Duplicate kernel status in the artifact stage.** Rejected because lifecycle state is session-wide rather than artifact-specific, and two copies would violate the single-authority placement rule.

## Consequences

Files and Outcomes resolve to different Details destinations; the Files landing view still includes the latest Outcome for context, while the Outcome destination excludes artifact navigation. Cross-artifact selections survive while the user composes one instruction but remain browser-local and clear only after accepted admission. Multi-target messages enlarge the durable `science-edit` source and model-visible text, while exact-version admission and `edit_of` ancestry remain unchanged per target. Trace is intentionally a linear semantic projection: DAG and kernel-epoch separators stay in engineering inspection, while delegation is one folded intent-group row rather than a separate lane.

The focused backend tests pin ordered commented targets and all-or-nothing validation. Client composition tests pin Science-only destinations, accessory, kernel, and Trace visibility plus bidirectional element staging; the keyless Science scenario pins the assembled multi-target message through a real runnable profile.
