# Agent Note: Desktop Harness home moves off Electron `userData`

Status: implemented

English | [中文](2026-08-25-desktop-harness-home-space-free.zh.md)

## Problem

The desktop carrier set `DSH_HOME` to `app.getPath('userData')`, which resolves to `~/Library/Application Support/DeepSeek Science` on macOS. The science-runtime R probe and kernel both refuse to run when their scratch `TMPDIR` contains an ASCII space (`packages/science/science-runtime/src/environment.ts:402`, `kernel-process.ts:340`), and `Application Support` itself contains a space. Every R kernel therefore failed unconditionally on desktop with `CONFINEMENT_UNAVAILABLE: R probe TMPDIR cannot contain an ASCII space`, regardless of which conda-family environment the user bound in onboarding.

## Decision

`apps/desktop/src/harness-home.ts` exports `resolveHarnessHome(osHomeDir)`, which resolves the Harness home to `<osHomeDir>/.papermachine`, creates it (mode `0700`) if missing, and throws `HarnessHomeSpaceError` if the resolved path still contains an ASCII space — an OS user home whose own path has one — naming the R `TMPDIR` restriction and stating plainly that the application cannot run science kernels from a space-containing home. `main.ts` calls it with `app.getPath('home')` (not `userData`) at every site that previously read `app.getPath('userData')`: `launchHost`, `openInitialSurface`, the `desktop:bind` IPC handler, and the `desktop:provision` IPC handler's `provisioner(...)` call. Electron's own `userData` directory keeps holding only Electron-owned state (cookies, caches) and is no longer read anywhere in this package.

`hostCommand` builds the Host's launch environment by spreading `process.env` and then setting `DSH_HOME: dshHome` after the spread, deliberately overriding any `DSH_HOME` the desktop app itself inherited from its own launching shell. A single resolved Harness home must stay authoritative across environment binding, the runtime overlay, and provisioning, all of which are already keyed to the `resolveHarnessHome` result for this launch; letting an inherited `DSH_HOME` win would let the Host read a different, unbound home than the one onboarding just wrote to.

`resolveHarnessHome` checks the literal joined path before creating anything (so an obviously space-containing OS home fails with no filesystem side effect), then creates the directory and re-checks its `realpath`-canonicalized form, which is also what it returns. Science Runtime derives every kernel and probe scratch path from the canonical, `realpath`-resolved Harness home (`scratch.ts`'s `rootForSession`), so a literal, space-free `osHomeDir` is not sufficient by itself: an OS home that is, or sits under, a symlink whose real target contains a space would otherwise pass the literal check and only fail later, inside a kernel process.

The same change renames the application: `main.ts`'s `app.setName('DeepSeek Science')` becomes `app.setName('PaperMachine')`, and `electron-builder.yml`'s `appId`/`productName`/`artifactName` follow, so a fresh install's `userData` moves to `~/Library/Application Support/PaperMachine`. This is orthogonal to the Harness home fix above — `userData` is no longer read for `DSH_HOME` at all — and needs no migration under the pre-release stance.

`HarnessHomeSpaceError` gets its own error page (`harnessHomeSpaceErrorPage`, states the offending path and the R restriction) instead of the general Host error page: it is a startup configuration failure, not a Host crash, so the ordinary "Restart Host" action — which would relaunch the Host against the same unusable path — would not help and is omitted. A shared `launchErrorPage(error)` picks between the two pages and is used at every launch/startup catch site (`openWorkspace`, `restartHost`, `boot`'s `openInitialSurface` catch); `onUnexpectedHostExit` (an actual Host crash) keeps using the general page with its restart action directly. The `desktop:bind`/`desktop:provision` IPC handlers still just reject their `ipcMain.handle` promise, which onboarding's existing `bindSelected`/detection catch blocks already display in the status line — no new UI there.

## Alternatives considered

**Keep `userData` and special-case the space in `TMPDIR` resolution instead.** Rejected: the space is in the Harness home root itself, not just the kernel scratch directory, so every child path (`environment-binding.json`, the runtime overlay, `desktop-environments/`) would need the same workaround, and the science-runtime restriction is enforced independently in two files this package does not own.

**Let the user relocate `userData` via Electron's `app.setPath('userData', ...)`.** Rejected: that call must run before `app.whenReady()` and before Electron reads its own `userData`-derived paths for logs and caches, entangling Electron's own state directory with the Harness home for no benefit — the two are unrelated concepts that happen to have shared a value.

**Add a compatibility read of the old `userData`-rooted home.** Rejected under the pre-release stance: there are no external consumers yet, and a migration shim would keep the space-containing path alive as a code path to maintain.

## Consequences

Every new desktop install gets a space-free Harness home unconditionally (`~/.papermachine` on a normal macOS account), so R kernels run. A user whose own home directory path contains a space still cannot run science kernels on desktop; the app fails loud at the point it would otherwise silently break inside a kernel process, naming the restriction. Pre-release: the prior per-user state under `~/Library/Application Support/DeepSeek Science` (and, before that name, `DSH Desktop`) is orphaned by design — nothing reads it any more, and no migration code was written. On the one machine this change shipped from, `settings.yaml`, `environment-binding.json`, and any `profiles/`/`sessions/` directories were copied by hand from the old `DeepSeek Science` location into `~/.papermachine/` as a local courtesy; this was not automated and does not run for any other install.

## Verification

`apps/desktop/tests/harness-home.spec.ts` covers: the resolved path is `<home>/.papermachine` and contains no space, the directory is actually created, repeated resolution against the same home is idempotent, a home directory whose own literal path contains a space rejects (as `HarnessHomeSpaceError`) without creating anything, and a space-free home directory that is itself a symlink into a space-containing real target also rejects, pinning the `realpath` re-check. `apps/desktop/tests/no-userdata-regression.spec.ts` statically scans every `apps/desktop/src/**/*.ts` file, with comments stripped, for a live `getPath('userData')` call and fails if one reappears, defending the original defect directly. `apps/desktop/tests/host-lifecycle.spec.ts` and the rest of the `apps/desktop` suite continue to pass unchanged since they exercise `HostLifecycle` directly with fixture commands rather than through `main.ts`'s Electron-dependent composition.
