# apps/web browser e2e

English | [中文](README.zh.md)

These tests boot the real web composition in-process and drive it with a real
Chromium over real HTTP. The lane's mechanics — modes, fixtures, goldens, and
the deliberate composition divergences from `dsh web` — are documented in
[`scaffold.ts`](scaffold.ts) and the
[browser e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md).

## Science replay scratch

The Science recorded-session scenarios create their isolated harness homes beneath the repository by default. For checkouts under a temporary directory, set `DSH_WEB_SCIENCE_SCRATCH_PARENT` to an existing writable directory outside canonical `/tmp` and `os.tmpdir()`. The test rejects temporary parents, allocates a unique child, and removes that child during teardown; the selected parent is retained.

## Mixed Science outcomes

`science-mixed.snapshot.ts` records one real model turn through a private test preset containing Science, filesystem, and `present` tools. The Science runtime retains its sandbox rules and uses the exact-operation kernel fixture shared with `science-preset.snapshot.ts`; the filesystem and delivery tools execute normally. Replay checks persisted PNG bytes, the complete workspace oracle, reasoning, and explicit delivery before comparing the browser transcript. The shipped Science preset keeps its independent restricted-tool assertions.

The mixed replay also exercises native completed-turn process expansion, the persisted Normal/Compact setting, and browser reload. It asserts that the final answer and both delivery groups remain visible, while physical Session logs, persisted events, and the selected recording remain byte-for-byte unchanged. `ui-chat` owns the streaming, cancellation and partial-history policy tests; `ui-science` owns Python/R cell details and reasoning-only composition cases. Cell output disclosures do not replace the native turn-level control.

## Completion observations

State-sensitive cases use Workspace, admission, attachment, and model-stream barriers to separate visible intermediate states from completed operations. Details close waits for frame transitions; archive verification assigns an explicit title to the seeded Session and follows that identity across reload. See the [CI fixture synchronization decision](../../../.agents/notes/implemented/testing/2026-09-08-ci-completion-observations.md).

## These are Host-face tests

They type-check in the root `tsconfig.host.json`, not in the Client aggregate,
because they read Host services directly: `ctx.connection`, the Host
`SessionStore`, and `ctx.sessionProjectionCache`. Driving a browser at runtime does
not make a file part of the Client program — the two faces merge cordis
`Context` under the same keys with different services, so one program cannot see
both. Moving these files into the Client aggregate makes every Host-service
access fail to compile.

## Do not import `@deepseek-ai/dsh-client-*` here

Importing a Client package — a value or a type — pulls its whole TypeScript
project, and every project it references, into the **Host build graph**. That has
bitten this lane once already: four Client consumer packages reference
`api/remotes`' Client face, which cannot compile until Host tsdown has generated
`@deepseek-ai/dsh-goal/remote`, so the Host build phase ended up waiting on an
artifact it produces itself.

When a scenario needs a Client-owned constant or pure function, mirror it here
instead, next to the commented-out import that names the source module. A drift
then surfaces as a missed selector or a stale mirrored value — a loud failure,
never a silent pass. `scaffold.ts` follows this rule for the welcome-notice
namespace, acknowledgement field, version, and asserted Chinese copy.

One kind of Client import stands. `assembled-boot.ts` drives the shell itself, so
it imports `AppWebEntry` from `@deepseek-ai/dsh-client-web` and the boot-manifest
type from `@deepseek-ai/dsh-client-modules/client`: booting the real shell is what
that harness is for, and both packages are already in the Host graph. The chat
scenarios mirror `conversationContextKey` in `support.ts` instead of importing
its Client owner.

Nothing mechanically enforces this rule; keep it in review.
