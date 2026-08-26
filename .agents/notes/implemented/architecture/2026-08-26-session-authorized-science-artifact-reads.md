# Agent Note: Session-authorized Science artifact reads

Status: implemented

English | [中文](2026-08-26-session-authorized-science-artifact-reads.zh.md)

## Problem

The [project artifact store S2](2026-08-26-project-artifact-store-s2.md) removed attachment references from `ScienceArtifactVersion`, but `ui-science` still asked the Session attachment service for artifact bytes. The browser could neither compile against the current projection nor safely read a store blob: a client-supplied project id would let the request choose an authorization domain unrelated to the named Session.

## Decision

`session.scienceArtifact({ sessionId, versionId })` is the only browser read path for one immutable Science artifact version. The gateway strictly folds the named Session before touching the store. If that fold contains the saved version, its `projectId`, hash, media type, and byte count are the trusted coordinates. If the fold proves an [S3](2026-08-26-project-artifact-store-s3.md) cross-Session run input, the log contains only artifact id and ordinal; the gateway therefore opens the project derived from the Session header's durable `cwd`, lists that artifact's versions, and accepts the requested version id only when the store row has the referenced ordinal. The request has no project-id field.

`ui-science` keeps stateless image and text loader call shapes, but both now call `ISession.readScienceArtifact(versionId)`. Images become `data:` URIs and text uses fatal UTF-8 decoding. Project-store images use a package-local preview component because attachment dimensions are not project-store metadata. This change restores Session artifact preview, download, provenance, Outcome evidence, and Turn-tail thumbnails; it does not add a project-level Files list, filter, or RPC.

## Alternatives considered

**Accept `projectId` beside `versionId`** — rejected because the client would select the store namespace before the Session log authorized it.

**Authorize only versions saved by the same Session** — rejected because S3 intentionally allows a run to cite an exact version produced by another Session in the same project. The corroborating `(artifactId, ordinal)` plus durable Session workspace is the minimum evidence retained by that Session's log.

**Add a project-wide artifact-listing RPC** — rejected because content retrieval needs one exact Session-authorized version only. A project Files surface remains separately scoped and is not implied by this read method.

## Consequences

The host API proxy now has optional runtime integration with `ScienceArtifactStore`; a composition without that provider fails the read explicitly while all unrelated RPCs remain available. Store read errors retain the store's stable code, whereas an unreferenced version fails as `VERSION_NOT_REFERENCED`. The API carrier and client runtime transport bytes as base64 and expose decoded `Uint8Array` values to presentation packages.

The S2 and S3 notes remain active history: this note implements S2's suggested Session-addressed RPC, with one necessary S3 adjustment. A cross-Session input cannot supply `projectId` or hash from its fold, so authorization corroborates its ordinal through the project derived from the durable Session header rather than pretending those coordinates were present locally.
