# Agent Note: Science process steps inside Trajectory

Status: proposed

English | [中文](2026-08-30-science-trace-process-view.zh.md)

## Problem

A turn's language counts and aggregate failures cannot show how an analysis reached its result. Analysts need to see the order of attempts, where failures occurred and which call produced a file. Repeating a view title or presenting the environment as agent work adds no such information.

## Proposal

Use Process as the default Science representation inside Trajectory, with slot id `process`, followed by Detailed. Preserve the user-request row. Use a single left rail with full-width cards and distinguish human edits by their user icon and blue left border. Four structured rows hold the request, ordered call markers, right-aligned totals with disclosure, and one final-version chip per artifact; they add no free-form explanation. Expansion reveals step numbers, kind markers, structured titles, results and call-owned artifact versions. Titles navigate to the first call represented by a row; artifact chips open exact versions.

Titles derive only from tool names, validated argument fields and Science projection facts. They never parse model prose or code, and neither code nor stdout/stderr enters Process. File arguments display only their basenames. Failed or incomplete JSON retains the tool name without inventing missing facts. Run records own run status and timing; tool-result errors classify other failures, while a missing result remains unknown.

Merge consecutive successful browse calls only within one turn, even across assistant step numbers. Preserve every member's title, anchor and strip marker. Runs, annotations, publications, delegations and failures remain separate. Totals count distinct step numbers in displayed rows, excluding answer-only steps and numbers hidden by browse merging; parallel calls still receive separate markers. Step numbers retain the agent's real sequence and can be nonconsecutive when intervening steps contain no tools. Rendering at most 120 strip markers bounds dense cards without truncating the expanded list.

Kernel lifecycle markers replace the environment card because starts and exits have authoritative times and explain whether interpreter variables survive. Terminal epochs retain their start time, so replay can show both ends. Markers precede their containing turn, including its start and end instants; an open turn has no upper bound. Outside a turn, markers precede the first later turn or follow the final turn. This keeps a kernel started during the first run ahead of that turn rather than after its exit. The start label names the current environment when available.

This proposal partially supersedes the card summary and subview name in [Science trajectory and transcript information architecture](../../implemented/feature/2026-08-25-science-trajectory-and-transcript-ia.md). Its nested Trajectory placement, preserved visited panels, transcript ownership and Turn-tail artifact reasoning remain useful. [Science transcript chrome suppression](../../implemented/feature/2026-08-25-science-transcript-chrome-suppression.md) continues to own conversation chrome; both records remain active for those independent decisions.

## Alternatives considered

**Keep the Science-specific light palette.** A preset-specific document palette defeats the application preference once Science is the product default. Keeping it would leave the theme buttons changing stored state without changing the workbench.

**Attribute files to the version's latest tool-call id.** Annotation can replace that id without producing a new file. Resolve `runId` to its generating call for both row and Turn ownership; only versions without run provenance use their own tool-call id. Missing run records leave the version in the summary without inventing a producing row. Each row carries its first call id for navigation. Kernel anchors identify language, epoch and lifecycle event instead of sharing the last Science event sequence.

**Keep opposite actor lanes and a three-row card.** Half-width cards and totals beside the strip break short call sequences into matrices. Full-width cards and a separate totals row preserve reading order; actor identity remains explicit on human-edit cards. This partially supersedes the actor layout in [Science workbench UI convergence](../../implemented/feature/2026-08-23-science-workbench-ui-convergence.md), whose composer and settings decisions remain useful.

**Keep only aggregate counts.** Counts hide attempt order, failed reads and the point at which a file appears. They remain useful beside the strip, but cannot substitute for it.

**Explain steps using model prose or parsed code.** This would duplicate the conversation or infer intent that no structured fact guarantees. Detailed remains the destination for the original call and its output.

**Keep a standalone environment card.** A static profile summary does not describe work performed. Lifecycle markers explain the observable event and its effect on variables at a recorded time.

**Keep every browse call as a separate list row.** Long stretches of reading obscure the runs and failures. Consecutive successful calls can share one row without losing their individual strip markers or navigation anchors.

## Acceptance criteria

### Application theme

The Science light override originated as a white document workbench for a distinct preset. Science becoming the product default removes that distinction: the override then masks every resolved dark palette although theme state and document attributes update correctly. Remove the AppFrame override, its preset selector and its coverage-table test. The sidebar, conversation, Process and library inherit the application preference; images alone retain the existing fixed light-canvas token so scientific plots remain readable without inversion or dimming.

This partially supersedes the light-palette decision in [Science workbench UI convergence](../../implemented/feature/2026-08-23-science-workbench-ui-convergence.md). Keep that record for its independent composer, settings and deployment-configuration rationale. A real Science-session Web scenario verifies dark, light and system gestures against rendered backgrounds, not only the body theme attribute.

Markers use two status colors plus neutral shapes: muted green runs and red failures, pale neutral ordinary calls, outlined annotations and solid publication circles. The strip and list share the same marker styling. Result text has no duplicate status dot; success uses caption text and failure uses red. Blue is reserved for selection and human edits, keeping failure the only high-saturation status.

- Ordered strip markers and expanded rows match cold replay, including parallel calls, browse merging, failures and intermediate artifact versions.
- Titles and rendered text expose no host file paths, code, model prose or tool output; malformed arguments retain only the tool name.
- Counts use recorded steps, runs and unique artifacts, and kernel markers retain both ends of terminal epochs.
- Disclosure, call navigation and exact-version artifact navigation work in the real Web composition at wide and narrow widths.

## Risks

The projection may contain runs or artifacts whose call heads lie outside the loaded conversation window. Process can show retained artifact facts but cannot reconstruct missing step titles. Kernel markers are positioned between turns, not between individual calls. The environment label uses the projection's current profile rather than an environment-history reconstruction. Long strips and artifact rows can wrap beyond one physical text line while preserving four structured rows without free-form explanations.

Nested subagent lanes, package-installation and manual-operation entries, and durable expansion state remain deferred. Delegation shows one call row and a Detailed handoff; installation and manual-operation rows require authoritative persistent events. Expansion and highlighting remain local to the mounted view, outside the artifact selection store and session log.
