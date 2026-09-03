# Agent Note: Preserve Science trajectory ownership across cold pagination

Status: implemented

English | [中文](2026-09-02-science-cold-trajectory-ownership.zh.md)

## Problem

The Science Process view joined runs to turns through tool-call blocks in the currently loaded conversation nodes. A cold session initially loads only the newest message page, while the Science projection already contains the complete run and artifact history. Calls outside that page therefore lost their turn and step even though the strict Science fold had indexed those coordinates from durable `tool/call` events. The view put those records in Unassigned history, omitted their steps and early turns from the summary, and repaired itself only after the user loaded older messages. One reproduced twelve-turn log retained all nineteen runs and four artifacts but initially rendered nine turns and twenty-one of twenty-nine calls; the eight missing calls comprised seven Science runs and one non-run tool call.

## Decision

The Science projection is the authority for trajectory structure. Its strict fold retains every turn lifetime and every post-binding tool-call identity, time, turn, step, and name in the sparse checkpoint witness. The browser-safe projection publishes those fields as `trace`, repeats the authorizing coordinates on runs, and assigns each newly committed artifact version the currently open run or annotation call's coordinates as its trace anchor. A later metadata-only re-record of that same version — `annotate_artifact` curating title or caption after its producing call has already settled — keeps the original producing call's coordinates; only a fresh content version, never a re-record, may take a new anchor, so curating a chart's metadata cannot move the Process view's ownership chip onto the curating call. Conversation nodes enrich projected calls with arguments and results when those nodes are loaded; they do not determine whether a call, turn, or run exists. A missing request node produces the existing unavailable-request placeholder. The UI prefers a version's store-recorded `producerTurn` (`ScienceVersionSummary.producer.turn`) over a store-time guess whenever a projection owner coordinate is absent: `saveArtifactAs` and a direct chart edit's human-edit commit both set it from the session's last started turn at the moment the viewer operation was called, so a version created in an idle gap between turns attributes to the turn that was current then, not to whichever turn is newest once the store write commits ([producer.turn attribution](../bug-fix/2026-09-03-science-viewer-write-turn-attribution-and-data-loading-guidance.md)). A version carrying neither a projection owner coordinate nor a store `producerTurn` — a direct human edit or import predating that fix, or a compatibility projection with an empty trace — falls back to the last known turn whose start time preceded the version's `createdAt`; a version whose `createdAt` precedes every known turn joins the unassigned-history section alongside runs instead of guessing a turn. This partially supersedes the pagination-dependent assignment in [Science process steps inside Trajectory](../feature/2026-08-30-science-trace-process-view.md) and the absence of client artifact coordinates recorded by [`science/artifact-saved` event slimming](../architecture/2026-09-02-science-artifact-event-slimming.md); both notes remain active for their independent decisions.

The private projection cache advances to state version 18 because turn records and artifact coordinates change its encoded fold and witness semantics. Turn and call transitions notify projection readers even when no `science/*` event changes `lastScienceEventSeq`; pre-mode turn starts remain private until Science mode binds.

## Alternatives considered

**Load the complete conversation before rendering Process.** Rejected because it couples trajectory correctness to an unbounded transcript fetch, delays cold startup, and duplicates facts already admitted by the Science fold.

**Infer missing turns from run timestamps.** Rejected because timestamps cannot recover the non-run call, parallel step identity, or an exact authorizing turn when timing windows overlap or are absent.

**Keep unassigned records until the user loads older messages.** Rejected because pagination is a presentation choice, not evidence that durable ownership is unknown.

## Consequences

Cold and live Process summaries use the same complete turn and call index, so loading earlier messages changes available request text and call details but not trajectory ownership or totals. The projection and its checkpoint grow by one compact record per turn and tool call; no arguments, results, message text, Host paths, or artifact-store provenance are added. Unit coverage pins checkpoint replay, wire coordinates, and tail-only UI assembly. A synthesized browser fixture pins twelve turns, twenty-nine calls, nineteen runs, four artifacts, and zero unassigned records without containing incident data.
