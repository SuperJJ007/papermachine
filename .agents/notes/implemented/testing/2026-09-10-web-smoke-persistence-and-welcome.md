# Agent Note: Web smoke fixtures respect persisted layout and welcome acknowledgement

Status: implemented

English | [中文](2026-09-10-web-smoke-persistence-and-welcome.zh.md)

## Problem

Independent browser gestures need a known layout, while a reload test must exercise the product's persisted preferences. Treating reload as a reset leaves restored tabs and floating resources in later cases. A fresh real Host also requires welcome acknowledgement even when a model credential is present; skipping it blocks workspace connection and makes every dependent smoke step fail before its intended behavior begins.

## Decision

The right-sidebar gesture helper clears only the current test session's `dsh.sidebar.right.v2.<sessionId>` preference before reloading. It leaves other sessions and unrelated browser preferences intact. The reload case instead preserves storage and checks the open dock, a floating document's identity and loaded contents, and repeated opening without duplication. It resets its own fixture only after these assertions.

The real-host smoke setup acknowledges the visible English welcome notice through Continue and waits for the dialog to detach and the application root to stop being inert. Workspace connection and the real model round follow this prerequisite. The fixture neither removes the production notice nor fabricates provider success.

## Alternatives considered

**Disable Sidebar persistence to preserve old assertions.** This would regress the product behavior owned by the [native Sidebar decision](../architecture/2026-09-10-science-native-sidebar.md).

**Clear all localStorage on every reload.** This would conceal broken persistence and erase unrelated preferences rather than isolate a gesture fixture.

**Increase waits or force clicks through the welcome modal.** Waiting cannot acknowledge the notice, and forced input bypasses the user interaction the smoke must exercise.

## Consequences

Gesture isolation and product recovery have separate assertions. The [Web browser lane](2026-07-24-web-gui-browser-e2e-lane.md) continues to own assembled coverage; Sidebar unit tests separately verify fresh undo history after restoration. A corrected setup does not prove later model or tool behavior passed: the two changed browser files still require a run against the built product. Product runtime code and shared build artifacts are unaffected by these fixture changes.
