# Agent Note: PaperMachine installation data isolation

Status: implemented

English | [中文](2026-09-10-papermachine-installation-isolation.zh.md)

## Problem

A locally built Science CLI can inherit the official DSH data directory even though its executable and dependencies are independent. A persisted Science default then reaches the official app, which does not provide that preset. Desktop also needs its own browser storage and single-instance lock on machines that have both products.

## Decision

PaperMachine entrypoints resolve their data root before loading profiles or application plugins. The shared path package owns the product selection: explicit launch path, `PAPERMACHINE_HOME`, the saved absolute-path `~/.papermachine-home` pointer, then the current user's `~/.papermachine`. Inherited `DSH_HOME` does not choose the product root. Canonical paths cannot overlap the official `~/.dsh`, including aliases through existing symlinks. The product passes the result as `DSH_HOME` to the unchanged runtime home mechanism described in [One harness home resolver](2026-07-24-single-harness-home-resolver.md).

The local CLI applies selection to the named `science` and `science-headless` profiles before boot, plugin management or config dump. Repository commands invoke that CLI directly. Ordinary DSH profiles keep their existing behavior. Desktop assigns PaperMachine's Electron name and browser storage before claiming its single-instance lock and passes the resolved root explicitly to active and staged Host processes. Development uses an isolated worktree home unless a PaperMachine override is supplied. Installed runtime resources continue to resolve from the bundled Node, private Host and version-bound package seed.

Release packaging uses the existing `com.papermachine.desktop` application ID, the `PaperMachine` product name, and `papermachine-` artifact names. Only `PAPERMACHINE_DESKTOP_APP_ID` can override the ID. Production builds require `PAPERMACHINE_DOWNLOAD_ORIGIN`; test builds retain `DOWNLOAD_TEST_ORIGIN`. Both reject the official download host and use `_/papermachine/desktop/stable/<target>/`. The selected update URL is embedded in the application, so installation requires no user environment setup. These product choices replace the shared-home and fixed-origin choices in [Electron desktop packaging and updates](2026-08-25-electron-desktop-packaging-and-updates.md); its signed seed, staging, and release verification decisions still apply.

## Alternatives considered

**Change official defaults.** This would alter an unrelated installation. Selecting only a profile or port still leaves user settings and home-level patches shared.

**Inherit or copy official state.** Using `DSH_HOME` as a product fallback permits a shell configured for official DSH to silently redirect PaperMachine. Copying old settings wholesale would also copy invalid presets and plugins. The explicit product selector preserves saved PaperMachine locations without importing official state.

## Consequences

Fresh installations use portable user-relative locations; spaces and Unicode are preserved. Migration acceptance supplies a disposable `PAPERMACHINE_HOME` and does not write installed data. A malformed saved location fails instead of silently starting a fresh installation. This selection does not migrate historical Science logs or provide Python/R provisioning. Session transcripts are unchanged; filesystem and real process-entry checks own this startup behavior.
