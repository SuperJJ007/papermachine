# Agent Note: restore exact Science artifact provenance from store producer facts

Status: implemented

English | [中文](2026-09-02-science-artifact-provenance-restoration.zh.md)

## Problem

The [project artifact store schema v2 migration](../architecture/2026-09-01-project-artifact-store-schema-v2.md) made the store authoritative for each version's producer identity. The later [client read-path migration](../architecture/2026-09-01-science-artifact-raw-byte-reads.md) removed the producer fields from the session artifact projection but exposed only display metadata through `sessions.scienceVersions`. The provenance drill-in consequently lost its Code, Execution log, Messages, and Environment pages and retained only content origin and creation time, even though the store still held the exact producer Session, run, tool call, request header, and turn.

Reconstructing the producer from a version's nearby turn or step is not valid. Human edits and imports need not have a run, two calls may share a turn, and a project-library version may have been produced in another Session whose projection is not loaded.

## Decision

**`ScienceVersionSummary` carries a required `producer` object copied from the already-authorized store `VersionRecord`.** The object contains the producer `sessionId` and its optional `runId`, `toolCallId`, `requestHeaderSeq`, and `turn`; `sessionTitle` is best-effort display text folded from the producer Session and is never part of identity or authorization. `sessions.scienceVersions` still resolves every requested version through `authorizedScienceArtifact` and omits an unauthorized id, so widening an authorized result does not create a second visibility rule or reveal whether an omitted version exists.

**The browser joins exact identities only after the authorized summary arrives.** A producer in the current Session is matched to `science.runs` by `runId`, with `toolCallId` as the exact fallback for a producer without a run entry; the same call id addresses the conversation tool-call projection. No turn/step proximity fallback exists. A producer in another Session shows its title or id on every provenance page and does not attempt to join the current Session's runs or calls. A library-opened artifact requests its version summary through the same session-scoped loader before rendering provenance.

**The four provenance pages have distinct, bounded responsibilities.** Code shows the producing run's source. Execution log shows that run's stdout and stderr. Messages shows exactly the producing Question and Result rows and exposes actions for the exact call and conversation location. Environment shows the current projection binding associated with the run; when the retained binding no longer matches the run's recorded environment revision, the page identifies the mismatch instead of presenting the current binding as historical fact. A missing run, call, log, message, binding, or cross-Session projection produces an explicit unavailable state on the affected page.

The selected provenance page remains in the existing session-scoped `provenanceSubTab` store field. The drill-in itself remains transient: reopening the Details column returns to artifact content while retaining the last selected provenance page for the next visit.

## Alternatives considered

**Restore producer fields on `ScienceClientArtifactVersion` and the session event** — rejected. The store already owns producer identity, and duplicating it into the artifact projection would reintroduce the two-authority drift that the store migration removed. The authorized version-summary read is the existing client-facing store metadata path.

**Infer a producer by matching the version's turn and step to a run or tool call** — rejected. Those coordinates are not unique producer identity and are absent for valid human-edit and import versions. They also cannot name a producer in another Session.

**Load the producer Session automatically for cross-Session versions** — rejected. Provenance rendering does not authorize or resume another Session. The current response may expose only the producer label already attached to the authorized store row; navigation or projection loading needs its own user-visible Session capability.

## Consequences

The Host API, schema, and handler expose store producer facts through `sessions.scienceVersions`; the runtime transports the widened summary unchanged. `ui-science` joins those facts to current-session run and conversation projections, restores the four-page provenance component for live and library-opened artifacts, and keeps explicit unavailable states for partial and cross-Session cases. No new session event or model-visible input is introduced.

Host model tests prove that authorized summaries carry producer facts and unauthorized versions carry nothing. Component tests cover each page, exact call navigation, missing facts, environment mismatch, and cross-Session presentation. The built Web Science outcome scenario exercises the restored drill-in in a real browser.
