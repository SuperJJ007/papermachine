# Agent Note: Project file library

Status: implemented

English | [中文](2026-08-26-project-file-library.zh.md)

## Problem

The Science Details view could discover only artifacts folded from its current Session. Artifacts produced by another Session in the same workspace and ordinary workspace files therefore had no project-level browsing surface, even though the project artifact store already owned the shared durable artifact history.

## Decision

The `sessions.scienceLibrary` RPC derives the project exclusively from the named Session's header `cwd`, then returns one latest-version record per project artifact. Requests never supply a project id. An origin Session title is a presentation hint folded from that Session when available; its absence neither hides the artifact nor creates a new event.

`sessions.scienceArtifact` first retains its Session-fold and cross-Session-input authorization paths. If neither proves the requested version, it derives the named Session's project from `cwd` and accepts an exact `getVersion(projectId, versionId)` match. This grants reads across Sessions only when the project artifact store proves common project ownership. A Session rooted in another workspace derives another project and cannot use this path.

`sessions.workspaceFiles` and `sessions.workspaceFile` expose a bounded, read-only view rooted at the named Session's canonical workspace. Paths are relative, reject absolute and parent segments, and are canonicalized before a containment check, so a symlink cannot escape the workspace. Directory reads are one level deep, omit hidden entries, symbolic links, and `node_modules`, and stop at 2,000 visible entries with an explicit truncation fact. File reads stop at 2 MiB. Only Science-preview media extensions receive a renderable media type; every other file is returned as `application/octet-stream` for the unsupported-preview state.

The browser selection store now holds an ordered union of artifact and file tabs. Artifact tab identity remains `artifact:<artifactId>` and continues to deduplicate a logical artifact while changing its selected version in place. File identity is `file:<relative path>`. A null active tab displays the library home without closing other tabs; the home has no tab or icon of its own, and closing the last document returns there.

The three RPCs are read-only and append no Session events. The project library refreshes whenever it becomes visible and when the current Session's Science artifact projection changes; it does not poll for writes from other Sessions.

## Alternatives considered

**Use `host.listDirectory`.** Rejected because it is a host directory-picker API and does not derive authority from a named Session's workspace.

**Send `projectId` from the browser.** Rejected because an opaque client-supplied project id would weaken the existing Session-scoped authorization rule. The Host can derive the project from durable Session state.

**Copy cross-Session artifacts into the current Session log.** Rejected because browsing is not model-visible input and must not create synthetic provenance or duplicate durable evidence.

**Poll the library.** Rejected because returning home already gives a deterministic refresh point, while polling would add background work and still not provide a transactional notification guarantee.

## Consequences

One workspace now has one browsable artifact library across its Sessions, while a different workspace remains isolated by canonical project resolution. Ordinary files can be previewed without granting arbitrary host filesystem access. The UI gains a second document kind and must switch exhaustively on that kind. Cross-Session changes become visible on the next visit to the library rather than immediately while the viewer remains open. Because the library RPC returns only the latest version record, a foreign artifact opens as a latest-only read-only preview; version stepping and edit controls remain available only when the current Session projection supplies that artifact's history.
