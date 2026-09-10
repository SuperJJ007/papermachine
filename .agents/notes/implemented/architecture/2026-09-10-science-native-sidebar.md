# Agent Note: Science views on native Sidebar and conversation services

Status: implemented

English | [中文](2026-09-10-science-native-sidebar.zh.md)

## Problem

Science needs project artifacts, exact-version editing and provenance without maintaining a second conversation shell, file browser or docking system. Persisted tabs must recover their resources before rendering, and asynchronous actions must retain their originating session.

## Decision

The Science plugin registers a `science-artifact` resource identity and native tab kind, body and title. Its stable address contains the artifact id; navigation parameters and session selection state carry the version. Authorized Science Remotes supply current metadata and bytes. The project library occupies the guide page, while workspace files use upstream Files and file viewers. No business metadata is persisted in the selection store.

The native Sidebar persists per-session layouts and adopts restored resource occurrences synchronously. The layout package persists rightbar width. Store persistence merges saved fields with initialized defaults and excludes declared transient fields. Each artifact pane owns provenance and lightbox state independently; Process disclosures survive sibling-view switches within a session.

Process and Trajectory are sibling conversation views. Science uses public input dock, header utilities, turn-tail, tool-view and tab-menu registrations plus the sidebar footer. A blank session has an identity before its first message; without a session no rightbar action is rendered. Native Turn Process Folding, context visibility and turn metrics remain in charge of Chat presentation.

Disposable submission handlers claim staged artifact edits before ordinary prompt transport and retain selections on failure. Session-addressed navigation preserves the originating session. A source-owned Chat definition renders the recorded edit instruction and exact-version references without model execution context. The ordinary session-recall projector preserves labels owned by other sources. Shared lightboxes live in UI primitives, and JSON summaries live in util-values, avoiding runtime imports between feature plugins.

## Alternatives considered

Reapplying private Details and nested trajectory slots would duplicate upstream ownership and increase future conflict cost. A global artifact-version URL would make each revision a different document. Persisting library facts would restore stale business data. Permanent transcript suppression would hide native controls even though real browser scenarios support the upstream folding behavior.

## Consequences

D9 keeps effective settings values required. P4 does not change Host authorization, legacy Session refusal or desktop packaging. Source components, public-service regressions and eight real Chromium scenarios cover the migration; the acceptance record names executed checks and remaining migration phases. Cross-session library previews expose the latest version only; exact historical version navigation relies on the current session projection.
