# Agent Note: Route HEAD to the raw-bytes Science artifact endpoint

Status: implemented

English | [中文](2026-09-02-science-artifact-head-route.zh.md)

## Problem

`GET /api/science/artifact/:sessionId/:versionId` (the [raw-byte reads](../architecture/2026-09-01-science-artifact-raw-byte-reads.md) endpoint) landed with a client download flow that HEAD-checks this exact URL before ever creating a save anchor, to classify a 410/409/other failure without opening a browser save dialog for a request that would fail (`ScienceDetailsView.tsx`'s `downloadArtifact`). The carrier's route match in `packages/host/apiproxy/src/fetch/handler.ts` gated on `req.method === 'GET'` only, unlike its `session.export` sibling three lines above it, which already handled `GET || HEAD`. A HEAD request never matched the regex, fell through to the generic POST-only dispatcher, and answered a bare carrier failure with no `x-science-artifact-error` header — so the preflight itself always failed and every download in a real deployment showed "Download failed. Try again.", regardless of the target version's actual health. `packages/host/apiproxy/tests/science-artifact-download.spec.ts` reported 100% coverage for this file while never issuing a HEAD request, so this shipped and passed CI: a routing gap on a request method is invisible to a test suite that only ever sends the other method.

## Decision

Route HEAD through the same match as GET, mirroring `session.export`'s exact pattern immediately above it in the same file: on a HEAD request, await the same `api.downloads.scienceArtifact(...)` call, cancel its body, and return a bodyless `Response` carrying the original status and headers (`x-science-artifact-error`, `Content-Type`, `Content-Length`, `Content-Disposition` included) unchanged. `api.downloads.scienceArtifact` itself needed no change — it already returns a normal `Response` for every branch (200/404/410/409/500); only the carrier's method gate and the post-call HEAD trim were missing.

## Alternatives considered

**Have the client drop the HEAD preflight and fall back to try/catch around the anchor click.** Rejected: this is exactly the design the [raw-byte-reads Note](../architecture/2026-09-01-science-artifact-raw-byte-reads.md) replaced (the base64 path's `.catch(() => {})` silently doing nothing on failure) — reverting it would resurrect the defect that migration fixed, not repair the regression this Note addresses.

**Add a dedicated `HEAD` case in `UNARY_ROUTES`.** Rejected: `UNARY_ROUTES` dispatches the POST/JSON-envelope RPC surface; the raw-bytes endpoint is deliberately a physical, no-envelope route (see the parent Note), so its HEAD handling belongs beside its own GET branch, not inside the RPC table.

## Consequences

`packages/host/apiproxy/src/fetch/handler.ts` (the route match and HEAD trim), `src/api/downloads.ts` (JSDoc naming the HEAD contract), `tests/science-artifact-download.spec.ts` (three new HEAD cases: a 200 success trim, a bodyless 410, and a bodyless 404 for an unproven version — `npx vitest run packages/host/apiproxy` 417/417 green, oxlint clean). No client-side file changed: `ScienceDetailsView.tsx`'s `downloadArtifact` already assumed the correct contract: this Note makes the server answer it. Found while building a real seeded `launchWebScaffold` fixture for T4c-2's screenshots/GIF evidence — the download button failed against a real server with a healthy blob, which a mocked-`fetch` unit test cannot surface.
