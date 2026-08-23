# Agent Note: Science workbench UI convergence

Status: implemented

English | [中文](2026-08-23-science-workbench-ui-convergence.zh.md)

## Problem

Science artifacts were reachable through a session Details action, but the surrounding product still treated conversation as the primary workspace. Project files and Outcomes lacked stable destinations, model-assisted edits used a second instruction composer inside the artifact viewer, and the engineering Trajectory view was the only event-level account available from the conversation view ring. These splits duplicated navigation and made selected chart elements disappear from the user's main request context.

## Decision

The Web shell presents one project workspace with stable Sessions, Files, and Outcomes destinations above the session browser. Settings remains fixed at the sidebar foot. The center conversation and right artifact stage share the width remaining after the sidebar by default; the stage also remains available before a Session is selected and explains that it will show real project artifacts after selection.

The Science Details entry remains the authoritative artifact stage described by [Science artifact viewer panel](2026-08-18-science-artifact-viewer-panel.md): opened artifacts use tabs, each tab owns version, provenance, download, and media-specific content, and data views are read-only. The stage selects Vega-Lite paths or normalized raster regions and adds them to the main composer as removable chips. A submission with chips becomes one durable `science-edit` user message with an ordered `targets` array; each target identifies its exact artifact version. Host admission validates every target against the complete folded session before enqueueing anything, identifies a failed list position, and attaches one image block for each raster target. Successful submission clears every chip; ordinary image attachments cannot accompany this structured edit.

Direct Vega-Lite style controls remain in the stage and commit a human-edit version without a model request. The embedded artifact instruction field and send action are absent, so model-assisted artifact changes have one composer and one visible request path.

The conversation ring includes a user-facing Trace view projected only from the loaded real Session nodes. It groups turns into intent, reasoning, action, and evidence lanes and delegates tool inspection to the existing Trajectory ledger. Persistent-kernel language, epoch, and lifecycle state appear in one fixed readout below the main composer.

The first composition registers Trace and the Science shell seats for every conversation because the Client has no Science-session predicate at those registration points. Target chips, including normalized-region labels, read from the Science locale rather than embedding English. The export implementation remains outside this decision; the artifact toolbar must carry a disabled localized placeholder until C4 supplies the operation.

## Alternatives considered

**Keep a second composer in the artifact stage.** Rejected because two send paths divide one request between artifact-local state and conversation history, and they cannot express one instruction over targets from several artifacts.

**Send one message per selected target.** Rejected because the user's instruction applies to the selection as a set; independent admissions permit partial acceptance and remove the requirement that the model coordinate the edits.

**Expose the engineering Trajectory ledger as the only trace.** Rejected because its raw event inspection and timing controls serve debugging. A compact semantic projection supports the user's causal reading while retaining a direct path to the ledger.

**Duplicate kernel status in the artifact stage.** Rejected because lifecycle state is session-wide rather than artifact-specific, and two copies would violate the single-authority placement rule.

## Consequences

Files and Outcomes share the Science stage in the first single-project release; Outcomes remain a section of its landing view rather than acquiring a pseudo-artifact tab. Cross-artifact selections survive while the user composes one instruction but remain browser-local and clear only after accepted admission. Multi-target messages enlarge the durable `science-edit` source and model-visible text, while exact-version admission and `edit_of` ancestry remain unchanged per target. Trace is intentionally a linear semantic projection: DAG, subagent lanes, and kernel-epoch separators stay in engineering inspection rather than the user view.

The focused backend tests pin ordered multi-target text, raster block order, and all-or-nothing validation. Client composition tests pin the destination, accessory, kernel, and Trace registrations; the keyless Science scenario pins the assembled multi-target message through a real runnable profile.
