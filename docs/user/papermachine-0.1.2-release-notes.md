# PaperMachine 0.1.2 release notes (draft)

English | [中文](papermachine-0.1.2-release-notes.zh.md)

## Desktop behavior

Windows Science execution uses the partial sandbox by default; no additional confirmation or environment variable is required. macOS retains full enforcement. Partial enforcement limits writes but does not provide complete file-read or network isolation; see the [Windows sandbox limitations](../../packages/sandbox/sandbox-windows-acl/README.md#known-limitations-and-deferred-work).

Environment preparation keeps the application responsive while unpacking and copying its bundled dependencies. On macOS, selecting a directory brings the native chooser forward. Installed-package checks on macOS arm64 and Windows x64 cover Python/R execution, artifacts, history, and restart recovery.

## Session compatibility

**PaperMachine 0.1.0 Science sessions cannot be opened in this version.** Opening an unsupported old session reports an error. The original session files are preserved unchanged; the application does not silently discard their Science records or overwrite the old log with a partial conversion. An old session may still appear in the session list because listing reads only its header.

Create a new session to continue working. New sessions use the V3 format and retain Science run records, artifact references, outcomes, and user notes across restarts. Recovery of 0.1.0 Science sessions is deferred, with no promised release date. Keep the original session files for possible future recovery.
