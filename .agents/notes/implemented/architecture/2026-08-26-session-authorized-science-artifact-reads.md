# Agent Note: Session-authorized Science artifact reads

Status: implemented

English | [中文](2026-08-26-session-authorized-science-artifact-reads.zh.md)

## Problem

The [project artifact store S2](2026-08-26-project-artifact-store-s2.md) removed attachment references from `ScienceArtifactVersion`, but `ui-science` still asked the Session attachment service for artifact bytes. The browser could neither compile against the current projection nor safely read a store blob: a client-supplied project id would let the request choose an authorization domain unrelated to the named Session.

## Decision

`session.scienceArtifact({ sessionId, versionId })` is the only browser read path for one immutable Science artifact version. The request has no project-id field. The gateway accepts the first applicable proof:

| Proof | Trusted coordinates |
|---|---|
| The named Session fold contains the saved version | Its logged project id, hash, media type, and byte count |
| The fold contains an [S3](2026-08-26-project-artifact-store-s3.md) cross-Session run input | The Session header's durable `cwd` derives the project; the store corroborates artifact id plus ordinal |
| Neither fold path matches, but the derived project contains the exact version id | `getVersion(projectId, versionId)` supplies the version metadata and proves same-project membership |

The third path supports the [project file library](../feature/2026-08-26-project-file-library.md): selecting a Session authorizes browsing immutable artifacts owned by the project derived from that Session, including versions produced by another Session in the same workspace. A different workspace derives a different project and cannot use this path.

`ui-science` keeps stateless image and text loader call shapes, but both call `ISession.readScienceArtifact(versionId)`. Images become `data:` URIs and text uses fatal UTF-8 decoding. Project-store images use a package-local preview component because attachment dimensions are not project-store metadata.

## Alternatives considered

**Accept `projectId` beside `versionId`** — rejected because the client would select the store namespace before the Session log authorized it.

**Authorize only versions saved by the same Session** — rejected because S3 intentionally allows a run to cite an exact version produced by another Session in the same project. The corroborating `(artifactId, ordinal)` plus durable Session workspace is the minimum evidence retained by that Session's log.

**Authorize only versions named by the current Session's log** — rejected because the project library deliberately displays every artifact in the Session's derived project. Requiring a synthetic reference event would misrepresent browsing as conversation history.

## Consequences

The host API proxy now has optional runtime integration with `ScienceArtifactStore`; a composition without that provider fails the read explicitly while all unrelated RPCs remain available. Store read errors retain the store's stable code, whereas an unreferenced version fails as `VERSION_NOT_REFERENCED`. The API carrier and client runtime transport bytes as base64 and expose decoded `Uint8Array` values to presentation packages.

The S2 and S3 notes remain active history: this note implements S2's suggested Session-addressed RPC, with one necessary S3 adjustment. A cross-Session input cannot supply `projectId` or hash from its fold, so authorization corroborates its ordinal through the project derived from the durable Session header rather than pretending those coordinates were present locally.
