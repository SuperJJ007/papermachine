# Agent Note: Preserve failure exits in silent Windows installers

Status: implemented

English | [中文](2026-09-09-nsis-silent-failure.zh.md)

## Problem

The macOS UninstallerReader path can produce a Windows uninstaller that fails its own CRC check before initialization; native Windows generation avoids this extraction path. An NSIS failure notification without a silent default can block unattended installation indefinitely. A hidden window station can also hide that dialog from a separate diagnostic process. An uninstall failure must remain observable as a failed process, without requiring interaction.

## Decision

The artifact-start hook rejects NSIS targets outside Windows, including prepackaged builds. CRC validation stays enabled. The pinned app-builder-lib 26.15.3 receives the NSIS template changes from [upstream PR 10034](https://github.com/electron-userland/electron-builder/pull/10034) through a pnpm patch. Failure notifications select their existing OK action in silent mode. The uninstall failure handler retains exit code 2; interactive notifications keep their existing behavior.

## Alternatives considered

Disabling CRC would hide an invalid generated executable. Reimplementing the binary extractor adds an unnecessary maintained fork when native Windows packaging already exists. Deleting uninstall registration to force an overwrite bypasses the failed operation and cannot establish upgrade correctness. Treating clean installation as upgrade acceptance misses the old-uninstaller path. A broad prerelease toolchain upgrade is unnecessary for this upstream template correction.

## Consequences

The patch makes this failure path terminate; it neither repairs an old uninstaller nor promises a deadline for every installer operation. Removal of the patch requires a pinned upstream version containing the same changes. Application runtime files and Mac packaging behavior are unaffected.

## Verification

The real Electron Builder prepackaged command fails on a Mac before creating the NSIS artifact, and platform tests retain native Windows acceptance. A Windows probe compiled from the real uninstall-result handler blocks without the patch when supplied exit code 2, returns 2 promptly with the patch, and returns 0 for success. Real-package acceptance separately covers preserved user data, cold history, clean installation, and overlay installation. Probe success alone does not identify the cause of a real upgrade failure.
