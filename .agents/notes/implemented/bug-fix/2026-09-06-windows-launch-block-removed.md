# Agent Note: Windows launch no longer shows the unsupported-platform page

Status: implemented

English | [中文](2026-09-06-windows-launch-block-removed.zh.md)

## Problem

[PR #17](https://github.com/SuperJJ007/papermachine/pull/17) added a win32 branch to `openInitialSurface()` (`apps/desktop/src/main.ts`) that always loaded `unsupportedPlatformErrorPage()` instead of starting onboarding, because at the time `startRun`/`prepareObservation` hard-rejected win32 before any kernel could spawn: the persistent kernel's response transport needed a POSIX FIFO, and Windows sandbox enforcement only ever reported `'partial'`. That block was an interim stop-gap for a real gap, not a permanent product position — the codebase had no supported way to run a Science kernel on Windows at all when it landed.

That gap has since closed. [The win32 kernel response-transport change](../feature/2026-09-05-win32-kernel-response-transport.md) replaced the FIFO transport with a loopback TCP channel and removed both win32 preflight rejections. [The `minimumEnforcement` change](../architecture/2026-09-05-science-runtime-minimum-sandbox-enforcement.md) let a deployment accept a `'partial'`-reporting sandbox by explicit configuration, and `apps/desktop`'s `runtime-overlay.ts` sets exactly that for `platform: 'win32-x64'`. [The scratch-privacy and probe-ordering fixes](2026-09-06-win32-scratch-privacy-and-probe-ordering.md) closed eight pre-existing defects (mode-bit privacy checks, probe-confinement ordering, test-harness POSIX assumptions, a non-fsyncable directory handle, a shebang-only fake sandbox runner, CRLF-translated capture files, and the kernel-spawn `minimumEnforcement` forwarding gap) that a real Windows Server 2022 run surfaced one after another once the transport and config work made a win32 kernel spawn reachable in principle. [The R locale and probe-argv fix](2026-09-06-win32-r-locale-and-ascii-probe-argv.md) closed the last blocker specific to R (`CHILD_LOCALES.win32` and non-ASCII probe argv). With every one of those landed, the same real box ran Python and R kernels end to end — spawn, run, cancel, and same-kernel state persistence — over the real loopback transport. The desktop-level block this note retires was the one remaining place still telling a Windows user the product could not do what it now does.

## Decision

**The win32 branch in `openInitialSurface()` and `unsupportedPlatformErrorPage()` are deleted outright, not hidden behind a flag.** A win32 launch now runs the identical `resolveEnvironmentBindingStatus` → onboarding/workspace path every other platform runs; `handleActivate()` needed no change because it was already only a second call to `openInitialSurface()`. `README.md`/`README.zh.md`'s Known Limitations and Roadmap sections are corrected to state what actually still differs on Windows (below) instead of "cannot yet execute Python or R."

**Remaining Windows-specific limitations still apply and are unchanged by this note:**

- Windows sandbox enforcement is file-write confinement only (`minimumEnforcement: 'partial'`); macOS enforces `'full'` (`science-runtime/README.md`'s Confinement and environment section).
- `interrupt()` is a no-op on win32, so cancelling or timing out a run always ends that kernel and loses every variable it held; macOS usually survives an interrupt (`science-runtime/README.md`'s "win32 interrupt loses kernel state").
- Win32 kernel execution's real-hardware evidence is one manual verification against real Conda interpreters, not a repeatable CI gate; nothing in this repository's CI spawns a real win32 kernel (`science-runtime/README.md`'s "win32 kernel execution's real-hardware evidence").

## Alternatives considered

**Keep a configuration flag to re-show the unsupported page if Windows regresses.** Rejected: the product has no state that needs "this platform is unsupported" as a maintained option — a regression is a bug to fix or revert, and an untested toggle that is never exercised in CI is itself a latent defect. Reverting this commit is simpler and more honest than carrying a flag that would silently rot.

**Leave the block in place until desktop-level first-launch onboarding is re-verified on real Windows hardware.** Rejected: the block was scoped to "the kernel cannot run at all," a claim now false; the open first-launch-onboarding verification gap (below) is a packaging/manual-QA task, not a reason to keep telling users a capability that works does not exist.

## Consequences

A Windows user's first launch now reaches onboarding and, once bound, can run Python and R analyses, matching the desktop-facing half of what the kernel-transport and sandbox-configuration changes already made possible on the runtime side. `apps/desktop/tests/error-page.spec.ts` loses its `unsupportedPlatformErrorPage` describe block. `pnpm vitest run apps/desktop` and `pnpm tsc -b tsconfig.host.json` both pass.

This change does not verify the real first-launch onboarding window sequence on Windows hardware — only kernel execution (spawn/run/cancel/state persistence) was confirmed on the real box the prior notes cite. A packaged build's real Windows first-launch pass remains open, tracked the same way as the other real-hardware gaps above: manual, not gated in CI.
