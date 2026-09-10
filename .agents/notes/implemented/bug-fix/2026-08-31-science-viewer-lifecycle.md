# Agent Note: Science viewer requests follow the active content

Status: implemented

English | [中文](2026-08-31-science-viewer-lifecycle.zh.md)

## Problem

Artifact reads and edit previews can finish after the user selects another version, closes a pane, or changes sessions.

## Decision

Native artifact panes scope asynchronous reads and preview work to their current immutable version and lifetime. Late completion cannot overwrite a newer selection. Preview result callbacks update presentation without being treated as a fresh edit that restarts the debounce cycle. Page-local undo and draft state end with their owning editor. Discard also ends the direct-control draft lifetime: remounting the control group restores text, font, legend, and checkbox values from the saved chart together, while clearing pending operations invalidates in-flight previews. Clearing only the operation list leaves visible inputs and later combined font edits inconsistent with the saved version.

Maximizing or restoring a pane changes layout, not session authorization. Cross-session viewing does not turn the viewed producer into the active editing session; Remote authorization and Runtime admission remain authoritative.

## Alternatives considered

**Use whichever response finishes last.** A slow old request would overwrite the user’s current selection.

**Watch preview callbacks as edit dependencies.** Each completed preview would schedule another preview.

**Infer edit permission from a maximized viewer.** Layout state does not prove project or session authority.

## Consequences

Closing a pane must invalidate pending presentation updates. Request cancellation is useful but insufficient by itself because completion may race cancellation; identity and lifetime checks still protect the result.

## Related

Related owners: [science-native-sidebar](../architecture/2026-09-10-science-native-sidebar.md); [chart-edit-baseline-isolation](2026-08-31-chart-edit-baseline-isolation.md).
