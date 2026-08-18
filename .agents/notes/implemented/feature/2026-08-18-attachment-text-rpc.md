# Agent Note: additive `session.textAttachment` RPC and `readTextAttachment`

Status: implemented

English | [中文](2026-08-18-attachment-text-rpc.zh.md)

## Problem

`dsh-host-apiproxy`'s `sessions.attachment` RPC, `ISession.readAttachment`, and the `imageLimits` projection unit are typed for `ImageAttachmentRef` at every layer: the wire schema, the `SessionsApi` interface, the browser client contract, and the constant-unit projection that lets clients pre-check intake limits. `dsh-attachment` and `dsh-session-attachment-index` already carry a parallel `TextAttachmentRef` family end to end, but nothing on the wire could read a text attachment's bytes back out, and no projection told a client the deployment's text-intake limits.

## Decision

Add `session.textAttachment` as a **new** RPC method beside `session.attachment`, never a widened return type on the existing one: widening an already-shipped method's return type would leave the wire mid-flight inconsistent for any client built against the old contract. `session.textAttachment` mirrors `session.attachment` at every layer: `SessionsApi.textAttachment` (request/response shapes), `sessionTextAttachmentRequestSchema`/`sessionTextAttachmentValueSchema`/`textAttachmentRefSchema`/`textMediaTypeSchema` in `sessions.schema.ts`, an `RpcMethodMap['session.textAttachment']` entry, a `UNARY_ROUTES`/`UNARY_VALUE_SCHEMAS` row in the fetch handler and client, and an `ApiProxy.sessions.textAttachment` implementation that authorizes through `ctx.sessionAttachments.findReferencedText` (added in [`SessionAttachmentIndex` authorizes text references too](2026-08-18-attachment-index-text-refs.md)) before reading through `ctx.attachments.readText`.

`data` on the wire is a plain UTF-8 string, not base64: `saveText`/`readText` admission already proved the stored bytes are valid UTF-8 (`dsh-attachment-local`'s `checkTextValidity`), so no binary transport encoding is needed, unlike the image path's base64 (raster bytes are not text-safe). The host encodes with `Buffer.from(stored.data).toString('utf8')`; the browser client (`Session.readTextAttachment`) passes the string straight through with no decode step, unlike `readAttachment`'s `atob`/`Uint8Array.from` decode.

`SessionProjectionMap` gains a `textLimits: TextAttachmentLimits` sibling to `imageLimits`, not a rename: renaming `imageLimits` would have touched every existing image-upload reader for no benefit to this change. `textLimits` is registered with the identical boot-constant shape as `imageLimits` (`apply: state => state`, `view: () => projectionCtx.attachments.textLimits`) in its own `ctx.inject(['sessionProjections', 'attachments'], ...)` block right after `imageLimits`'s.

`ISession.readTextAttachment(attachmentId)` joins `readAttachment` on the browser-facing contract, implemented in `Session` (`packages/client/runtime/src/client/sessions/session.ts`) and stubbed fail-loud in the `test-support` fixture, mirroring `readAttachment`'s existing pattern exactly.

## Alternatives considered

**Widen `sessions.attachment`'s response to `attachment: ImageAttachmentRef | TextAttachmentRef`.** Rejected: a widened existing method would ship a type the server cannot fully answer until every dependent layer (client decode, UI dispatch) lands, leaving the wire in a half-implemented state mid-stack. A new method name means `session.attachment` ships unchanged and `session.textAttachment` is an independent additive unit from the moment it exists.

**Base64-encode `textAttachment`'s `data` for symmetry with `attachment`.** Rejected: base64 exists on the image wire because raster bytes are not safely embeddable as a JSON string; text bytes already are, post-admission. Encoding a string as base64 only to decode it back to the same string on the client adds a round-trip with no correctness benefit.

## Consequences

Every `SessionsApi`/`IApiClient` implementer needed a `textAttachment` member added to keep implementing the widened interfaces: two `api-proxy-projections.spec.ts`/`fetch-carrier.spec.ts`/`client-handler.spec.ts` scripted fixtures, `packages/client/connection/src/client/fixture.ts` (the browser dev/demo fixture, which gained an empty `texts` map since no current fixture scenario uploads a text file — `textAttachment` mirrors `attachment`'s authorization/lookup mechanics against it regardless), and both `fake-api.client.ts` copies under `packages/client/connection/tests` and `packages/client/runtime/tests`.

`packages/host/apiproxy/tests/api-proxy-projections.spec.ts`'s existing `imageLimits` constant-unit test used a throwaway `textLimits = { maxTextBytes: 0, mediaTypes: [] }` stub (needed only to satisfy `AttachmentStore`'s abstract member before this change, since nothing read it) — registering a real `textLimits` projection unit now validates that value against `textLimitsProjectionSchema`'s `.positive()` check on every `session.history` call, so the stub's `0` started failing the read. Fixed to a valid representative value and folded into one test asserting both `imageLimits` and `textLimits` publish together, mirroring the single `AttachmentStore` composition that carries both. A new `api-proxy-models.spec.ts` test (`authorizes text attachment bytes only when the session event stream references the id`) exercises the `textAttachment` RPC's authorization/not-referenced paths the same way the existing image test exercises `attachment`, registering a synthetic extractor against `science/artifact-saved` (session-attachment-index's only currently merged extractor-required key) since no built-in message-content carrier can hold a text-file attachment today.

`packages/extensions/cordis-client-runner/src/client/api-catalog.ts` picked up `ISession.readTextAttachment` via `pnpm run gen-cordis-inspect-catalog` (its actual generator — the file's banner names `gen-cordis-api.ts`, the compatibility entry point for the unrelated server-side `ctx.<service>` catalog in `packages/extensions/tool-cordis`, which does not touch this file). `packages/host/apiproxy`'s bilingual README documents the gateway now owning three projection units instead of two.

The redesigned Science viewer panel, `annotate_artifact`'s tool surface, and runtime auto-capture are unaffected: this change is wire-only, additive, and has no current caller producing a text-attached artifact version yet.
