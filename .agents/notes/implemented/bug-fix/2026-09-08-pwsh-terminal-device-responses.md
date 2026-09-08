# Agent Note: Answer PowerShell terminal device queries before sending setup

Status: implemented

English | [中文](2026-09-08-pwsh-terminal-device-responses.zh.md)

## Problem

PowerShell's interactive host requests cursor position with `ESC[6n` and waits for a terminal response. Discarding this sequence leaves the shell blocked. Sending prompt setup before that exchange completes also mixes command input with the response the host expects. A substring search for `dsh> ` compounds the problem: the echoed setup command contains that text even when no command has executed.

## Decision

Each local PTY session owns an `@xterm/headless` terminal using its configured dimensions and zero scrollback. Raw output advances this maintained emulator, whose protocol responses go back through the subprocess terminal. The existing sanitizer and bounded line buffer retain their prompt-marker and model-output responsibilities. The emulator is disposed before terminal teardown; response-write failures use the same transport-failure path as other writes.

PowerShell startup first waits for initial shell readiness, then sends its encoding and prompt setup once. Subsequent waits require a complete controlled-prompt line and share one configured deadline. An echoed function definition cannot complete startup.

## Alternatives considered

A fixed cursor-position response would unblock some hosts while reporting incorrect coordinates after cursor movement. Extending the sanitizer into a cursor emulator would duplicate maintained terminal-protocol code. Increasing silence or test timeouts cannot answer a query the host is waiting for.

## Consequences

PowerShell command execution, persistent state, and UTF-8 output are covered through real PTYs and a real Loader composition. Split cursor queries, cursor movement, failed response writes, echoed setup, and startup timeout have deterministic coverage. The additional emulator stores only its bounded screen; this does not turn the line-oriented transcript into a full-screen terminal UI.
