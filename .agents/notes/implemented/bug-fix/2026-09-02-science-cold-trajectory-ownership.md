# Agent Note: Preserve Science trajectory ownership across cold pagination

Status: implemented

English | [中文](2026-09-02-science-cold-trajectory-ownership.zh.md)

## Problem

The Science Process view joined runs to turns through tool-call blocks in the currently loaded conversation nodes. A cold session initially loads only the newest message page, while the Science projection already contains the complete run and artifact history. Calls outside that page therefore lost their turn and step even though the strict Science fold had indexed those coordinates from durable `tool/call` events. The view put those records in Unassigned history, omitted their steps and early turns from the summary, and repaired itself only after the user loaded older messages. One reproduced twelve-turn log retained all nineteen runs and four artifacts but initially rendered nine turns and twenty-one of twenty-nine calls; the eight missing calls comprised seven Science runs and one non-run tool call.

## Decision

The Science projection is the authority for trajectory structure. Its strict fold retains every turn lifetime and every post-binding tool-call identity, time, turn, step, and name in the sparse checkpoint witness. The browser-safe projection publishes those fields as `trace`, repeats the authorizing coordinates on runs, and repeats the active run or annotation coordinates on artifact presentation snapshots. Conversation nodes enrich projected calls with arguments and results when those nodes are loaded; they do not determine whether a call, turn, or run exists. A missing request node produces the existing unavailable-request placeholder. The UI uses store creation time only for direct human edits, imports, and compatibility projections with an empty trace. An artifact version without a projection owner coordinate — including a run-produced version saved between turns, when `saveArtifactAs` copies a prior version's `contentOrigin` with no run or annotation call open — falls back to the store's `createdAt` against known turn windows, the same rule a direct human edit uses; the unassigned-history section holds only runs. This partially supersedes the pagination-dependent assignment in [Science process steps inside Trajectory](../feature/2026-08-30-science-trace-process-view.md) and the absence of client artifact coordinates recorded by [`science/artifact-saved` event slimming](../architecture/2026-09-02-science-artifact-event-slimming.md); both notes remain active for their independent decisions.

The private projection cache advances to state version 18 because turn records and artifact coordinates change its encoded fold and witness semantics. Turn and call transitions notify projection readers even when no `science/*` event changes `lastScienceEventSeq`; pre-mode turn starts remain private until Science mode binds.

## Alternatives considered

**Load the complete conversation before rendering Process.** Rejected because it couples trajectory correctness to an unbounded transcript fetch, delays cold startup, and duplicates facts already admitted by the Science fold.

**Infer missing turns from run timestamps.** Rejected because timestamps cannot recover the non-run call, parallel step identity, or an exact authorizing turn when timing windows overlap or are absent.

**Keep unassigned records until the user loads older messages.** Rejected because pagination is a presentation choice, not evidence that durable ownership is unknown.

## Consequences

Cold and live Process summaries use the same complete turn and call index, so loading earlier messages changes available request text and call details but not trajectory ownership or totals. The projection and its checkpoint grow by one compact record per turn and tool call; no arguments, results, message text, Host paths, or artifact-store provenance are added. Unit coverage pins checkpoint replay, wire coordinates, and tail-only UI assembly. A synthesized browser fixture pins twelve turns, twenty-nine calls, nineteen runs, four artifacts, and zero unassigned records without containing incident data.
