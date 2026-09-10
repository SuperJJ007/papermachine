# Agent Note: Science artifact identity belongs to the producing session

Status: rejected — superseded by the artifact-store authority-rule redesign, which restores cross-session continuation under a store-enforced unique logical name instead of scoping identity to the producing session

English | [中文](2026-08-30-science-artifact-identity-per-session.zh.md)

## Problem

File names do not establish artifact identity across conversations. On 2026-08-30, a fresh conversation produced grouped_bar_chart.png at v6 because a different session had created that name on August 29 and edited it four times. A second unrelated scatter_plot.png started at v2 for the same reason. The data and titles were unrelated; habitual model naming joined their version chains.

## Proposal

Automatic capture creates a new artifact at v1 whenever the current session's fold has never recorded its logical name. Only the current session's existing artifactId continues a chain. Project lists identify rows by artifactId and permit duplicate logical names, with no schema change.

Cross-conversation relationships require explicit exact-version artifact_inputs. edit_of remains session-local. Old logs retain their recorded ordinals, including first-seen v6 events; the fold accepts these historical records while the live capture create path supplies v1.

This supersedes only the same-name cross-session continuation decision in [project artifact store S3](../../implemented/architecture/2026-08-26-project-artifact-store-s3.md). That note remains useful for explicit project inputs and store access. Its historical text is retained unchanged.

Direct-edit forms group multiple axes under localized panel headings and keep complete kind names in one content-sized column. References outside the grouped rows retain panel numbers. The Details shell provides separate keyed action and tab slots, with the conversation and Details tabs sharing one theme stylesheet. The existing Science selection store shares open-library metadata between tabs and content.

Grouping the artifact library by originSessionId follows directly from session-owned identity: a conversation owns each group even when file names collide. Group headers carry the origin title and latest artifact time; cards do not repeat the source. The current conversation stays first, while card sorting stays within groups. Collapsed groups and the library page persist through the existing selection-store engine under session-scoped localStorage keys. Relative-time formatting lives once in ui-primitives for workspace rows and library groups.

## Alternatives considered

**Renumber versions only in the display.** Showing v7 as “conversation version 2” leaves model-visible chips and get_science_state at v7, and a human edit still selects another conversation's figure as its parent. It hides the symptom without repairing identity.

**Continue by matching file name.** Model-generated names routinely collide across unrelated analyses; a match proves neither shared data nor edit intent. Explicit artifact_inputs preserve the intentional relationship without guessing.

## Acceptance criteria

Different sessions capturing the same logical name create distinct artifactIds at v1, including identical bytes; the first artifact's latestVersionId is unchanged. Same-session edits continue their chain and old logs remain replayable. Package tests and keyless Science snapshots verify the behavior and UUID guidance.

Browser evidence covers complete Chinese and English labels, multiple-panel grouping, single-panel absence of headings, panel-aware composer references, fresh version numbers, and equal title-row and tab baselines in both columns. A project-store query confirms independent same-named rows.

## Risks

A project can contain several artifacts with the same logical name. Titles, timestamps, and artifactId distinguish them; consumers must not assume project-wide name uniqueness. Old accidental chains remain visible because session logs are immutable. Cross-session direct editing still requires a separate lineage design.
