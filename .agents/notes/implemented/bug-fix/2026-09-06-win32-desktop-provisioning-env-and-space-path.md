# Agent Note: win32 desktop provisioning gets an ambient environment, and a space-containing Harness home gets a recovery page

Status: implemented

English | [中文](2026-09-06-win32-desktop-provisioning-env-and-space-path.zh.md)

## Problem

Provisioning children need enough Windows environment to initialize OS services and find Conda DLLs without receiving every credential in the desktop process.

## Decision

The provisioner filters credential-shaped environment variables and preserves a fixed set of Windows OS-root and process variables. TEMP and TMP point to private provisioning scratch. Windows PATH lookup is case-insensitive and emits one normalized PATH key. Health checks prepend the installed prefix’s executable and DLL directories; creation does not depend on a prefix that has not been populated.

The desktop and Runtime keep equivalent environment requirements without linking the desktop to the separate Science Host implementation. Source-level consistency checks guard duplicated lists. ProductEnvironment and native setup own the current caller; shared installation isolation owns root selection.

## Alternatives considered

**Forward all ambient environment.** Credentials could enter child output and diagnostic logs.

**Assume Electron’s directory supplies micromamba CRT DLLs.** The source investigation disproved that premise; app-local CRT distribution requires packaging evidence.

**Emit both Path and PATH.** Windows treats them case-insensitively, creating ambiguous precedence.

**Apply health-check prefix paths during creation.** Those directories may not exist until installation finishes.

## Consequences

OS initialization variables are not a license to inherit arbitrary secrets. Private scratch and explicit Conda PATH order remain necessary. This note does not reinstate the removed desktop space-free resolver or claim current CRT packaging readiness; those decisions require their current owners and actual artifacts.

## Related

Related owners: [papermachine-installation-isolation](../architecture/2026-09-10-papermachine-installation-isolation.md); [desktop-owns-its-environment](../feature/2026-09-01-desktop-owns-its-environment.md); [win32-kernel-response-transport](../feature/2026-09-05-win32-kernel-response-transport.md).
