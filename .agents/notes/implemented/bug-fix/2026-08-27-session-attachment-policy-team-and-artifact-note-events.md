# Agent Note: session-attachment-index classifies team/* and Science artifact-note events

Status: implemented

English | [中文](2026-08-27-session-attachment-policy-team-and-artifact-note-events.zh.md)

## Problem

`dsh-session-attachment-index`'s `policy.ts` closed lists (`BUILT_IN_CARRIER_EVENT_TYPES`, `ATTACHMENT_FREE_EVENT_TYPES`) are hand-maintained and checked against `KNOWN_SESSION_EVENT_TYPES` by a freshness test. Six known event types added since the lists were last updated had no entry in either list: `experimental/agent-team`'s `team/member`, `team/task`, `team/message/queued`, `team/message/delivered`, and `dsh-science-session`'s `science/artifact-note-added`/`-removed`. An unclassified known type is implicitly `extractor-required`, which authorizes nothing until a domain calls `register()` — no package does for these six, so any image reference they carried was silently unauthorized rather than deliberately excluded, and `packages/session/session-attachment-index/tests/policy.spec.ts`'s `'classifies every known session event type exactly once'` caught the drift.

## Decision

Read each event's payload type before classifying, per the package's own stated discipline (closed lists, not "everything left over"):

- `team/message/queued`'s payload is `{ version, teamId, message: TeamMessageSnapshot }` (`packages/experimental/agent-team/src/types.ts`), and `TeamMessageSnapshot.content: ContentBlock[]` is a real team-message body that can carry an `image` block — the same `data.message.content` shape `extractBuiltInAttachments` (`packages/session/session-attachment-index/src/extract.ts`) already scans for `assistant/message`-style events. Classified `built-in`: no new extractor needed, the existing scanner already reaches it structurally.
- `team/message/delivered`'s payload (`{ version, teamId, messageId, targetId }`) is a delivery acknowledgement referencing an already-recorded message by id, with no content field. Classified `attachment-free`.
- `team/member` (`{ version, teamId, member: TeamMemberSnapshot }`) and `team/task` (`{ version, teamId, task: TeamTaskSnapshot }`) carry only plain roster/task metadata (id, name, description, status, and similar scalar fields) — no content array anywhere in either snapshot type. Classified `attachment-free`.
- `science/artifact-note-added`/`-removed` (`packages/science/science-session/src/domain.ts`) carry only `artifactId`, a version/seq number, plain user-typed note `text`, and timestamps — the same shape as the already-`attachment-free` `science/outcome-published`/`science/kernel-state` siblings. Classified `attachment-free`.

## Alternatives considered

**Classify all six `attachment-free` for simplicity, since only one (`team/message/queued`) structurally carries content.** Rejected: `team/message/queued` genuinely can carry an image (team members exchange the same `ContentBlock[]` bodies chat messages do), and the built-in scanner already reaches its exact wrapped-`message.content` shape with no new code — leaving it `attachment-free` would silently drop a real, already-supported attachment reference from the Session ZIP export and the live attachment RPC.

**Register a `team/message/queued` extractor instead of adding it to `BUILT_IN_CARRIER_EVENT_TYPES`.** Rejected: an extractor is for a shape the generic scanner cannot reach (a different field name, a transform); `message.content` is exactly the wrapped-content pattern the scanner is built for, so declaring it `built-in` reuses the existing code path instead of duplicating it in a new one.

## Consequences

The freshness test's closed-list invariant holds again: every currently known event type has a deliberate, single classification. `team/message/queued` images (the only genuinely content-bearing type among the six) are now authorized attachment references, reachable through the live RPC and included in Session ZIP export, matching how the same shape already works for other message-carrying event types.

## Verification

`packages/session/session-attachment-index/tests/policy.spec.ts`'s `'classifies every known session event type exactly once'` passes with the six types added to their respective lists. `packages/experimental/agent-team`, `packages/science/science-session`, and `packages/host/apiproxy` suites pass unchanged, confirming no current consumer depended on any of the six staying `extractor-required`.
