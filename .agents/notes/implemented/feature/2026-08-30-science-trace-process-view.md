# Agent Note: Science process steps inside Trajectory

Status: implemented

English | [中文](2026-08-30-science-trace-process-view.zh.md)

## Problem

A turn's language counts and aggregate failures cannot show how an analysis reached its result. Analysts need to see the order of attempts, where failures occurred and which call produced a file. Repeating a view title or presenting the environment as agent work adds no such information.

## Decision

Process is the default Science representation inside Trajectory, with slot id `process`, followed by Detailed. It preserves the user-request row. A single left rail holds full-width cards; human edits have a user icon and blue left border. Four structured rows hold the request, ordered call markers, right-aligned totals with disclosure, and one final-version chip per artifact; they add no free-form explanation. Expansion reveals step numbers, kind markers, structured titles, results and call-owned artifact versions. Titles expand the represented calls in place; artifact chips open exact versions in the file viewer without selecting Detailed. The card request and background toggle the Turn; its native disclosure button supports Enter and Space. Independent controls and the complete input/output area, including headings, status text and blank space, keep their own clicks, scrolling and text selection. Local Turn and call expansion survive subview switches.

Titles derive only from tool names, validated argument fields and Science projection facts. They never infer intent from model prose or code. Runs show a literal first-line code preview; merged browse rows list their member titles. File titles display only their basenames. Explicit call inspection displays the logged code, input arguments and result, splitting recognized run stdout/stderr and reporting recorded kernel, environment revision, failure code, byte counts and truncation flags. Code, arbitrary arguments and output each share the artifact text display limit, with visible truncation notices and bounded scrolling. Non-text blocks report count and type without serializing attachment data. Original logged paths are visible only in explicit input inspection; the view never reads host-only environment fields. Failed or incomplete JSON retains the tool name without inventing missing facts. Run records own run status and timing; tool-result errors classify other failures, while a missing result remains unknown.

Consecutive non-failed browse calls merge only within one turn, even across assistant step numbers. Each row preserves every member's title, anchor and strip marker. Runs, annotations, publications, delegations and failures remain separate. Totals count distinct step numbers containing calls, including numbers inside merged rows and excluding answer-only steps; parallel calls still receive separate markers. Step numbers retain the agent's real sequence and can be nonconsecutive when intervening steps contain no tools. Rendering at most 120 strip markers bounds dense cards without truncating the expanded list.

Kernel lifecycle markers replace the environment card because starts and exits have authoritative times and explain whether interpreter variables survive. Terminal epochs retain their start time, so replay can show both ends. Markers precede their containing turn, including its start and end instants; an open turn has no upper bound. Outside a turn, markers precede the first later turn or follow the final turn. This keeps a kernel started during the first run ahead of that turn rather than after its exit. The start label names the current environment when available.

This decision partially supersedes the card summary and subview name in [Science trajectory and transcript information architecture](2026-08-25-science-trajectory-and-transcript-ia.md). Its nested Trajectory placement, preserved visited panels, transcript ownership and Turn-tail artifact reasoning remain useful. [Science transcript chrome suppression](2026-08-25-science-transcript-chrome-suppression.md) continues to own conversation chrome; both records remain active for those independent decisions.

Retained runs and artifacts require a loaded producing call before joining a request. Missing calls leave these records in a separate unassigned-history section with counts and exact-version artifact links; earlier-page loading recomputes their assignment. Falling back to the latest turn invents provenance and inflates its duration and artifact totals. An annotation call cannot establish the producing turn of a run-owned version.

## Alternatives considered

**Keep the Science-specific light palette.** A preset-specific document palette defeats the application preference once Science is the product default. Keeping it would leave the theme buttons changing stored state without changing the workbench.

**Attribute files to the version's latest tool-call id.** Annotation can replace that id without producing a new file. Resolve `runId` to its generating call for both row and Turn ownership; only versions without run provenance use their own tool-call id. Missing run records leave the version in the summary without inventing a producing row. Kernel anchors identify language, epoch and lifecycle event instead of sharing the last Science event sequence.

**Keep opposite actor lanes and a three-row card.** Half-width cards and totals beside the strip break short call sequences into matrices. Full-width cards and a separate totals row preserve reading order; actor identity remains explicit on human-edit cards. This partially supersedes the actor layout in [Science workbench UI convergence](2026-08-23-science-workbench-ui-convergence.md), whose composer and settings decisions remain useful.

**Keep only aggregate counts.** Counts hide attempt order, failed reads and the point at which a file appears. They remain useful beside the strip, but cannot substitute for it.

**Explain steps using model prose or parsed code.** This would duplicate the conversation or infer intent that no structured fact guarantees. A literal code preview and on-demand logged inputs and outputs provide evidence without assigning intent.

**Keep a standalone environment card.** A static profile summary does not describe work performed. Lifecycle markers explain the observable event and its effect on variables at a recorded time.

**Send process inspection to Detailed.** This loses the reader’s place and makes a compact view depend on the engineering ledger. Local input/output expansion preserves context while Detailed remains an independent optional view.

**Keep every browse call as a separate list row.** Long stretches of reading obscure the runs and failures. Consecutive non-failed calls can share one row without losing their individual strip markers or navigation anchors.

## Verification

### Application theme

The Science light override originated as a white document workbench for a distinct preset. Science becoming the product default removes that distinction: the override then masks every resolved dark palette although theme state and document attributes update correctly. AppFrame has no Science palette override. The sidebar, conversation, Process and library inherit the application preference; images alone retain the existing fixed light-canvas token so scientific plots remain readable without inversion or dimming.

This partially supersedes the light-palette decision in [Science workbench UI convergence](2026-08-23-science-workbench-ui-convergence.md). Keep that record for its independent composer, settings and deployment-configuration rationale. A real Science-session Web scenario verifies dark, light and system gestures against rendered backgrounds, not only the body theme attribute.

Markers use two status colors plus neutral shapes: muted green runs and red failures, pale neutral ordinary calls, outlined annotations and solid publication circles. The strip and list share the same marker styling. Result text has no duplicate status dot; success uses caption text and failure uses red. Blue is reserved for selection and human edits, keeping failure the only high-saturation status.

- Ordered strip markers and expanded rows match cold replay, including parallel calls, browse merging, failures and intermediate artifact versions.
- Collapsed cards omit execution detail; explicit local inspection shows only recorded call material. Malformed arguments remain readable without being treated as validated fields.
- Counts use recorded steps, runs and unique artifacts, and kernel markers retain both ends of terminal epochs.
- Component tests cover source, arbitrary-argument and result display limits and protected detail-area clicks. The keyless real Web composition pins collapsed, expanded and inspected output, Enter/Space, card-background and child controls, text selection, every call type, exact-version files and subview retention at wide and narrow widths.

## Consequences

The projection may contain runs or artifacts whose call heads lie outside the loaded conversation window. Process can show retained artifact facts but cannot reconstruct missing step titles. Kernel markers are positioned between turns, not between individual calls. The environment label uses the projection's current profile rather than an environment-history reconstruction. Long strips and artifact rows can wrap beyond one physical text line while preserving four structured rows without free-form explanations.

Nested subagent lanes, package-installation and manual-operation entries, and durable expansion state remain deferred. Delegation shows one call row with local logged input/output inspection; installation and manual-operation rows require authoritative persistent events. Expansion and highlighting remain local to the mounted view, outside the artifact selection store and session log.
