# Agent Note: The same-id conflict test's tracked-stdin fixture dropped `KernelProcess`'s own `stdin.on` call

Status: implemented
Archived: 2026-09-10

English | [中文](2026-09-07-kernel-set-conflict-fixture-stdin-listener.zh.md)

## Problem

`kernel-set.spec.ts`'s `discards the losing kernel through EXIT/quiesce after a same-id byId conflict, never leaving it running unregistered` test failed deterministically (reproduced 3/3 on an idle machine, ~3s each run): `expect(fulfilled).toHaveLength(1)` saw an empty array instead. Both concurrent `acquire()` calls rejected — the intended loser with `KernelSetConflictError` as designed, but the intended winner with `TypeError: this.stdin.on is not a function` thrown out of `KernelProcess`'s constructor (`kernel-process.ts:320`).

The test's own `wrapTrackingKernelSpawns` helper (added 2026-09-06 in `2dd0ad1a7b`, alongside this test) substitutes a fake `stdin` object on every tracked spawn's handle, exposing only `write` (to count `EXIT` frames):

```ts ignore-check
const trackedStdin = {
  write: (chunk: string) => { ... return realStdin.write(chunk) },
} as unknown as NonNullable<SubprocessHandle['stdin']>
```

`KernelProcess`'s constructor has unconditionally called `this.stdin.on('error', ...)` since 2026-09-03 (`5719e6c597`, three days before the fixture was written) to catch an async EPIPE a synchronous `write()` try/catch cannot observe. The fixture never accounted for that pre-existing call: any real kernel spawned through the wrapped subprocess crashes in its own constructor, regardless of the same-id conflict logic the test exists to exercise. `KernelSet`'s actual conflict-detection and discard behavior (`syncBusyRegistration`, `discardUnregisteredKernel`) was never at fault — the fixture's fake `stdin` was.

## Decision

`trackedStdin` now also forwards `on` to the real stdin unchanged, alongside the tracked `write`:

```ts ignore-check
const trackedStdin = {
  on: (event: string, listener: (...args: unknown[]) => void) => realStdin.on(event, listener),
  write: (chunk: string) => { ... return realStdin.write(chunk) },
} as unknown as NonNullable<SubprocessHandle['stdin']>
```

No production code changed and no assertion loosened: the test's own three assertions (`fulfilled`/`rejected` counts, `rejected[0]?.reason` is `KernelSetConflictError`, `spawnCount()` reaches 2, `exitWriteCount()` reaches 1, the winner's kernel executes a real run, `disposeAll()` settles cleanly) are unchanged and now all pass because the winner's kernel can actually construct.

## Alternatives considered

- **Spread the real `stdin` and override only `write`** (`{ ...realStdin, write: tracked }`). Rejected: `Writable`'s `on`/`write`/etc. live on its prototype chain (`EventEmitter.prototype`), not as own enumerable properties, so a plain object spread of a stream instance silently drops them — this would reproduce the exact same missing-`on` failure the fixture already had.
- **Loosen the test to not require a real `KernelProcess` construction for the winner** (e.g., swap in a fake winner process). Rejected: the test's whole point is asserting real subprocess/EXIT-frame behavior (`spawnCount`, `exitWriteCount`, the winner executing a real run) through the actual `KernelProcess`/`KernelSet` wiring — faking the winner would stop covering the real construction path this defect lived in.

## Consequences

The test now passes deterministically (5/5 reruns of the targeted case; full `kernel-set.spec.ts` and `packages/science/science-runtime` suites otherwise unaffected). `wrapTrackingKernelSpawns`'s stdin substitution now matches `wrapWithUnprovenQuiescence`'s existing pattern of forwarding everything it does not need to intercept.

A separate, pre-existing flake was observed while verifying this fix: `lifecycle.spec.ts`'s `quarantines a same-ID successor until an in-flight run's lease settles` fails only under full-suite concurrent load (not in isolation, 3/3), with an unrelated unhandled rejection in `settlePublishedKernelRun` (`index.ts:2043`). Out of scope here — not one of this task's three named gate-debt items, and not reproducible in isolation the way the fixed test was.
