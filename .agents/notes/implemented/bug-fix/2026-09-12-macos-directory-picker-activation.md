# Agent Note: Activate the macOS directory chooser

Status: implemented

English | [中文](2026-09-12-macos-directory-picker-activation.zh.md)

## Problem

A macOS directory chooser spawned by the installed Desktop Host can wait inside its native modal dialog while the product window remains in front. The workspace action then appears unresponsive even though the chooser process is alive.

## Decision

The macOS native picker sends `activate` to its own AppleScript process before `choose folder`. It retains the selected-path result, user-cancellation mapping, and caller-owned process cancellation. It does not automate Finder or require a second application's permission.

## Alternatives considered

**Leave activation to the operating system.** A background Node Host does not reliably foreground the chooser when it creates the modal panel.

**Move Desktop picking onto another transport.** Explicit activation addresses this native adapter's missing operation without introducing a second Electron-to-Host request protocol.

## Consequences

The command-adapter regression fixes the activation-before-modal ordering and retains cancellation and failure coverage. Installed-package acceptance owns foreground behavior; a recorded Session cannot observe window activation, and the fix changes no Session events or model-visible content.
