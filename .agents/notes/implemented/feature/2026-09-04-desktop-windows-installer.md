# Agent Note: the desktop carrier ships a Windows installer

Status: implemented

English | [中文](2026-09-04-desktop-windows-installer.zh.md)

## Problem

Every layer below `apps/desktop` already ran on Windows. science-runtime carries a per-platform interpreter layout table (`EXECUTABLE_LAYOUTS` in `environment.ts`: `python.exe` and `Scripts/Rscript.exe` under `win32`), and the Host's process handling branches on `win32` for detached spawning, process-group signalling, and liveness probes. The carrier alone refused to run: `desktopPlatform()` threw on any non-darwin platform, `DesktopPlatform` named only the two macOS pairs, `resources/micromamba.json` pinned only the two macOS assets, `electron-builder.yml` declared only a `mac` target, and `qualifyingInterpreters` looked exclusively for `bin/python` and `bin/Rscript`.

The product owner has no Windows device, so the port could not be validated the way the macOS build was — on the machine it ships to.

## Decision

`DESKTOP_PLATFORMS` (`src/environment-declaration.ts`) is the one list of platform-architecture pairs this carrier ships for, and `DesktopPlatform` derives from it. `win32-x64` joins the two macOS pairs. The declaration parser's platform check, `isDesktopPlatform` (used by `desktopPlatform()` and by `fetch:micromamba` to reject an unknown target), and the shipped `general.json` declaration all read that one list, so adding a target is a single-line change that the test suite then holds the rest of the tree to.

Windows-on-ARM is deliberately not a target. conda-forge's `win-arm64` subdir has no `r-base`, and the x64 installer runs under emulation there.

`micromambaExecutableName` names the bundled binary — `micromamba.exe` under a `win32-` target — because the fetch script and the runtime lookup in `main.ts` must agree on the name and Windows refuses to execute an extensionless image. `resources/micromamba.json` gains the pinned `win-64` asset with the checksum the fetch script verifies before writing.

`qualifyingInterpreters` (`src/interpreter-presence.ts`) resolves the two interpreters through a platform-selected layout mirroring science-runtime's table. The carrier cannot import that table: the Host that owns it is a separate process staged into the package. The mirror is a duplicated fact, accepted because the alternative is a package dependency from the carrier onto a Host-side package for two path fragments; both sides carry a comment naming the other.

Telemetry reports platform and architecture in separate envelope columns, so `main.ts` maps `DesktopPlatform` to that pair through `TELEMETRY_TARGETS`, a `Record` over the closed union — adding a target without deciding how it is reported fails the build.

`electron-builder.yml` gains an x64 NSIS target. The installer is per-user (`perMachine: false`): an unsigned per-machine installer adds a UAC prompt on top of the SmartScreen warning, and the application writes only under the user's home. `write-update-metadata.ts` takes the installer extension as its argument, knows which architectures a complete build of each platform produces, and rejects a run that produced fewer — the invariant the old hard-coded "expected one arm64 and one x64 DMG" carried, now stated per platform.

`.github/workflows/desktop-release.yml` builds both platforms on dispatch and collects the artifacts into one **draft** release. A draft does not create its tag and is invisible outside the repository's writers, so a build can be produced, downloaded, inspected, and deleted without any public trace — the property that makes it safe to ship a Windows target no one has run on a Windows device.

## Alternatives considered

**A Windows job on the existing `ci.yml`.** Its Windows jobs target `dsh-windows-2025-16core` and the `dsh-win-ci` self-hosted pool — runner labels that resolve only inside the upstream organization. A release workflow that must also work in a personal fork uses GitHub-hosted `windows-latest`.

**Publishing directly instead of drafting.** A published release is visible the moment the repository is public and its tag is created immediately. Drafting keeps both decisions in the hands of a person looking at the artifacts.

## Consequences

The Windows installer is built and the carrier's own tests run on a Windows runner, but no Windows device has accepted a release. `apps/desktop/README.md` states that limitation, and the product README still lists macOS as the supported platform: that claim changes when a device acceptance says it can, not when a build succeeds.

Both packaging scripts select the official client profile with `pnpm -w run build --profile official` rather than a leading `DSH_BUILD_CLIENT_PROFILE=official`: pnpm runs a package script through the platform's own shell, and cmd.exe rejects an environment assignment as a command whatever shell the surrounding CI step uses. Both also pass `--publish never`, because Electron Builder otherwise reads the `repository` field and demands a GitHub token at the end of an otherwise finished build.

`apps/desktop/tsconfig.json` now includes `scripts`, which were type-checked by no compiler face before. Adding them caught a real narrowing bug in the first version of `write-update-metadata.ts`'s argument handling.

## Verification

`pnpm vitest run --root . apps/desktop/tests` — 224 existing tests plus four new ones: the shipped declaration supports every platform an installer is built for, the manifest pins a checksummed asset for every one of them, an unshipped platform id is rejected, and the Windows binary is named `.exe`.

`node --import tsx/esm apps/desktop/scripts/fetch-micromamba.ts win32-x64` downloaded the pinned asset, matched its recorded digest, and wrote `micromamba.exe`; `file` reports `PE32+ executable (console) x86-64, for MS Windows`.

The workflow's Windows job runs the carrier tests and executes the fetched `micromamba.exe --version` before packaging, so a wrong-architecture or non-executable asset fails before it can be buried inside an installer.

The first dispatched run paid for itself immediately. Its Windows job failed two carrier tests that had never run anywhere but POSIX: `stopProcessGroup`'s fake `ChildProcess` carried only a `pid`, so the Windows branch's `child.kill(signal)` had no method to call, and the environment-binding test asserted `0o600` on a platform whose `stat` reports `0o666` for any writable file because permissions live in ACLs, not mode bits. Both are fixed in the tests, not the product. Its macOS job aborted with a V8 out-of-memory inside the repository-wide `tsc -b tsconfig.host.json`: a hosted macOS runner is a 7 GB machine, so Node sizes old-space at roughly half of that, and the workflow now sets `NODE_OPTIONS=--max-old-space-size=6144`. The second run then built both DMGs and failed at Electron Builder's publish step and at cmd.exe's rejection of the environment prefix — the two facts recorded above.
