# Agent Note: Local macOS installed-package acceptance

Status: implemented

English | [中文](2026-09-12-local-macos-package-acceptance.zh.md)

## Problem

Interactive installation, environment provisioning, native clipboard and directory dialogs, and Session recovery need an installed application. Requiring release signing credentials for every local run blocks this evidence on development Macs.

## Decision

PaperMachine local macOS acceptance permits ad-hoc signing without repeatedly requesting release credentials. The explicit `DSH_DESKTOP_LOCAL_ACCEPTANCE=1` packaging mode builds the same product, bundled runtime, and offline seed, including Host health checks and pnpm digest rewriting after native-code signing. Local resources and installers use a separate directory, omit update configuration and release completion records, and cannot enter the upload workflow. Release signing, notarization, and update qualification remain owned by [Desktop packaging](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md).

## Alternatives considered

**Require Developer ID and notarization for local acceptance.** These establish distribution trust, but are not prerequisites for testing installed behavior on an authorized development Mac.

**Use a source launcher.** Workspace links and development startup bypass the packaged seed and installed-profile activation, so they cannot establish installed-app acceptance.

## Consequences

Local packages provide installation and interaction evidence without release credentials. They do not establish Gatekeeper distribution or signed-update readiness. Local mode rejects production updates and unsupported targets; focused packaging tests cover isolation, absent publishing configuration, upload refusal, and unchanged release credential requirements. Existing user data remains in place during acceptance.
