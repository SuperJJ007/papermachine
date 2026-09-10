# Agent Note: WSL workspace directory selection stays in the Host filesystem

Status: implemented

English | [中文](2026-09-11-wsl-workspace-directory-selection.zh.md)

## Problem

WSLg can advertise a display and an installed Linux chooser without presenting a usable dialog to the browser operator. Separately, collapsing Home ancestry hides the route to the filesystem root and mounted Windows volumes. Upstream reports describe both [invisible WSL dialogs](https://github.com/deepseek-ai/deepseek-harness/discussions/929) and [inaccessible mount navigation](https://github.com/deepseek-ai/deepseek-harness/discussions/2700).

## Decision

The adaptive picker selects browse on Linux with inherited non-empty `WSL_DISTRO_NAME` or `WSL_INTEROP`. Launch provenance excludes project/user `.env` values. An explicit native composition remains available. The browse dialog exposes a filesystem-root shortcut when Home hides that ancestor, and labels the existing absolute-path editor. The root comes from the Host listing; no drive letters or mount prefixes are synthesized. The selected path passes unchanged to workspace creation, whose existing canonicalization owns durable identity.

## Alternatives considered

Trusting WSLg display markers preserves the invisible-dialog failure. Guessing `/mnt/c` assumes the default automount configuration. Converting a selected path into Windows syntax confuses filesystem access with execution-environment selection. A Windows-hosted application accessing a WSL UNC directory still has a Windows runtime; choosing that directory does not establish Linux execution support.

## Consequences

The policy trades native WSL dialogs for a browser interaction that also works without WSLg. Environments that remove both inherited markers must explicitly compose browse; kernel-name heuristics are omitted because containers can share a WSL kernel without its interactive environment. Resolver tests cover both markers, blank values, and native Windows. Loader tests cover launch provenance; its Linux-only WSL case remains platform-gated. Component and assembled Web tests cover leaving Home, entering a Unicode path with spaces, and workspace/session directory identity. Real Windows dialog acceptance and WSLg execution remain separate platform evidence.

The active [Win32 string decoding decision](2026-08-31-win32-picker-path-string-read.md) still owns COM allocation and Koffi conversion; this decision neither replaces it nor ports the older owned-buffer PR into the current decoder.
