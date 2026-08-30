# Agent Note: Science process steps inside Trajectory

Status: proposed

English | [中文](2026-08-30-science-trace-process-view.zh.md)

## Problem

A turn's language counts and aggregate failures cannot show how an analysis reached its result. Analysts need to see the order of attempts, where failures occurred and which call produced a file. Repeating a view title or presenting the environment as agent work adds no such information.

## Proposal

Use Process as the default Science representation inside Trajectory, with slot id `process`, followed by Detailed. Preserve the user-request row and actor-owned timeline layout. Replace the aggregate-only row with ordered call markers and a disclosure control; show one final-version chip per artifact in the collapsed card. Expansion reveals step numbers, kind markers, structured titles, results and call-owned artifact versions. Titles navigate to the first call represented by a row; artifact chips open exact versions.

Titles derive only from tool names, validated argument fields and Science projection facts. They never parse model prose or code, and neither code nor stdout/stderr enters Process. File arguments display only their basenames. Failed or incomplete JSON retains the tool name without inventing missing facts. Run records own run status and timing; tool-result errors classify other failures, while a missing result remains unknown.

Merge consecutive successful browse calls only within one turn, even across assistant step numbers. Preserve every member's title, anchor and strip marker. Runs, annotations, publications, delegations and failures remain separate. Distinct assistant step numbers determine step totals; parallel calls still receive separate markers. Rendering at most 120 strip markers bounds dense cards without truncating the expanded list.

Kernel lifecycle markers replace the environment card because starts and exits have authoritative times and explain whether interpreter variables survive. Terminal epochs retain their start time, so replay can show both ends. Markers precede their containing turn, including its start and end instants; an open turn has no upper bound. Outside a turn, markers precede the first later turn or follow the final turn. This keeps a kernel started during the first run ahead of that turn rather than after its exit. The start label names the current environment when available.

This proposal partially supersedes the card summary and subview name in [Science trajectory and transcript information architecture](../../implemented/feature/2026-08-25-science-trajectory-and-transcript-ia.md). Its nested Trajectory placement, preserved visited panels, transcript ownership and Turn-tail artifact reasoning remain useful. [Science transcript chrome suppression](../../implemented/feature/2026-08-25-science-transcript-chrome-suppression.md) continues to own conversation chrome; neither record is changed by this proposal.

## Alternatives considered

**Keep only aggregate counts.** Counts hide attempt order, failed reads and the point at which a file appears. They remain useful beside the strip, but cannot substitute for it.

**Explain steps using model prose or parsed code.** This would duplicate the conversation or infer intent that no structured fact guarantees. Detailed remains the destination for the original call and its output.

**Keep a standalone environment card.** A static profile summary does not describe work performed. Lifecycle markers explain the observable event and its effect on variables at a recorded time.

**Keep every browse call as a separate list row.** Long stretches of reading obscure the runs and failures. Consecutive successful calls can share one row without losing their individual strip markers or navigation anchors.

## Acceptance criteria

- Ordered strip markers and expanded rows match cold replay, including parallel calls, browse merging, failures and intermediate artifact versions.
- Titles and rendered text expose no host file paths, code, model prose or tool output; malformed arguments retain only the tool name.
- Counts use recorded steps, runs and unique artifacts, and kernel markers retain both ends of terminal epochs.
- Disclosure, call navigation and exact-version artifact navigation work in the real Web composition at wide and narrow widths.

## Risks

The projection may contain runs or artifacts whose call heads lie outside the loaded conversation window. Process can show retained artifact facts but cannot reconstruct missing step titles. Kernel markers are positioned between turns, not between individual calls. The environment label uses the projection's current profile rather than an environment-history reconstruction. Long strips and artifact rows can wrap beyond one physical text line while preserving the three content rows.

Nested subagent lanes, package-installation and manual-operation entries, and durable expansion state remain deferred. Delegation shows one call row and a Detailed handoff; installation and manual-operation rows require authoritative persistent events. Expansion and highlighting remain local to the mounted view, outside the artifact selection store and session log.
