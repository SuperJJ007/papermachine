# Agent Note: PaperMachine product replant on dsh 0.1.5

Status: proposed

English | [中文](2026-09-09-papermachine-replant.zh.md)

## Problem

PaperMachine depends on fork-local session, subprocess, RPC, and browser APIs that differ from the dsh 0.1.5 implementation. Merging both implementations would preserve obsolete application composition and duplicate public extension mechanisms.

## Proposal

Use the approved 0.1.5-alpha.1 tree as the baseline and import the eight PaperMachine packages. Package versions follow dsh; the product release version remains independent. A science-app bundle and science profile own product composition. RPC, sidebar resources, and session storage use the target APIs. Old V0 sessions remain on disk and are explicitly refused until a separate migration is implemented.

Importing source is not acceptance. P1 requires a working branded profile, compiler and dependency checks, and an explicit owner for every temporary stub. Host behavior belongs to P2/P3; the sidebar belongs to P4; desktop composition belongs to P5. No missing compiler API is restored to upstream packages merely to make imported source compile.

## Alternatives considered

A merge of the old fork retains removed runtime and Detail-panel mechanisms. A tree-external product cannot add required Science event types to the static session catalog. Both alternatives conflict with the approved target architecture.

## Acceptance criteria

Each phase has a separate commit and recorded checks. P1 must not be reported complete while compilation or branded-profile acceptance fails. Runtime, session-format, browser, desktop, and integration acceptance remain required before replacing main.

## Risks

Temporary stubs can hide unfinished migration if their ownership and refusal behavior are unclear. Runtime and UI code therefore remain unaccepted until their phase checks pass. The pre-replant main and original user session files remain available.
