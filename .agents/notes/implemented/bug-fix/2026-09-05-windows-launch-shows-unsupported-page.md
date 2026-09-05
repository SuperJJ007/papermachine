# Agent Note: Windows launch shows the unsupported-analysis page before any download

Status: implemented

English | [中文](2026-09-05-windows-launch-shows-unsupported-page.zh.md)

## Problem

On Windows, the Science kernel cannot run at all: `startRun` already hard-rejects win32 (kernel transport needs a POSIX FIFO and the `mkfifo`/`cat` binaries), and sandbox enforcement is only partial on the Windows backend. Before this fix, a Windows user who launched the app still walked through onboarding and downloaded the ~520 MB bundled environment, only to find every run rejected afterward ([issue #14](https://github.com/SuperJJ007/papermachine/issues/14)).

[PR #17](https://github.com/SuperJJ007/papermachine/pull/17) added a win32 check to `openInitialSurface()` that loads an explanatory page instead of starting onboarding, but on a first launch `window` is still `undefined` at that point — it is created later, inside `openOnboarding()`/`openWorkspace()` — so `window?.loadURL(...)` was a silent no-op and the user saw no window at all. The PR's README wording also claimed Linux support, which this product does not ship, and its new `ScienceRuntimeError` code and message for the equivalent win32 rejection during environment binding did not match the code `startRun` already used for the same platform gap.

## Decision

`openInitialSurface()`'s win32 branch now creates the window before loading the page — `window ??= createWindow('system')`, the same pattern `boot()`'s own failure fallback uses — then loads `unsupportedPlatformErrorPage()`. `'system'` is fixed rather than resolved from a persisted preference so the platform check never depends on the Harness home being resolvable (a space-containing home, for instance, must not block this page). `handleActivate()` calls `openInitialSurface()` again whenever `BrowserWindow.getAllWindows().length === 0`, so a later `activate` re-entry on win32 recreates the window and reloads the same page rather than throwing or opening onboarding.

`unsupportedPlatformErrorPage()` takes no parameters: its only caller is already on a `process.platform === 'win32'` branch, so the parameter it previously ignored was dead. Its copy states plainly that PaperMachine cannot yet run Python or R analyses on Windows in this release, that the environment was not downloaded, that Windows support is on the roadmap, and to use a Mac meanwhile — it does not mention WSL2, which is not a path this product tests or supports.

`packages/science/science-runtime/src/environment.ts`'s win32 rejection inside `prepareObservation` (reached through `bindEnvironment`) now throws `KERNEL_UNSUPPORTED_PLATFORM`, the same code `startRun` already used for its own win32 rejection, instead of `CONFINEMENT_UNAVAILABLE`. `CONFINEMENT_UNAVAILABLE` remains reserved for a sandbox that is genuinely unavailable or under-enforced on a supported platform; conflating that with "this platform is not supported at all" made the two failures indistinguishable by code alone.

`README.md`/`README.zh.md`'s Known Limitations now state that analysis runs on macOS (Apple silicon and Intel); the Windows x64 installer is published for the desktop carrier, but the Science Runtime cannot yet execute Python or R on Windows because its kernel transport needs a POSIX FIFO and Windows sandbox enforcement is only partial, so the app says so at launch instead of downloading the environment. Linux is not named as a supported analysis platform in either language — this product ships macOS and Windows builds only.

## Alternatives considered

- **Keep `CONFINEMENT_UNAVAILABLE` for the win32 probe rejection.** Rejected: that code already means "the sandbox is available but not fully enforced" elsewhere in the same file (an R `TMPDIR` with a space, a prefix overlapping a writable root); reusing it for "this platform has no supported kernel transport at all" erases a distinction the code should carry, and left it inconsistent with `startRun`'s own `KERNEL_UNSUPPORTED_PLATFORM` for the identical platform gap.
- **Resolve a window theme preference from the Harness home before showing the win32 page.** Rejected: the platform check must hold regardless of whether the home is resolvable, and `boot()`'s own failure fallback already establishes `'system'` as the preference to fall back on when no home-backed preference is available yet.
- **Mention WSL2 as a workaround in the error page.** Rejected: WSL2 is not a path this product builds, tests, or supports; naming it would promise something the maintainer has not accepted.
- **Keep the README's claim of Linux support.** Rejected: Linux was cut from this product earlier and has no release build; stating otherwise misinforms a reader deciding whether to install.

## Consequences

A Windows launch — first boot or a later `activate` with no open windows — always shows a real window carrying the unsupported-platform page; it can no longer land silently on no window at all. `unsupportedPlatformErrorPage()`'s signature has one fewer, previously-unused parameter. `bindEnvironment` and `startRun` now reject a win32 host with the same `KERNEL_UNSUPPORTED_PLATFORM` code, so callers and tests distinguish "not supported here" from `CONFINEMENT_UNAVAILABLE`'s "not enforced enough here" by code alone. Windows kernel transport and full sandbox enforcement remain future work (tracked in the README Roadmap); this change only makes the interim behavior honest about that gap. Verified by `apps/desktop/tests/error-page.spec.ts` and `packages/science/science-runtime/tests/environment.spec.ts` on macOS; the real Windows launch sequence (window creation preceding the page load) has not been re-verified on Windows hardware.
